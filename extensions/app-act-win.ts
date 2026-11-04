// app_act on Windows: the same requests and answers as the macOS helper, done by a PowerShell script through UI Automation.
// No permission prompt and nothing to compile; apps running as administrator stay out of reach (Windows' own limit).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type Exec = (command: string, args: string[], options: { timeout: number; signal?: AbortSignal }) => Promise<{ code?: number; killed?: boolean; stdout?: string; stderr?: string }>;

// ASCII only: Windows PowerShell 5.1 reads a .ps1 without BOM as the ANSI code page.
export const WIN_SCRIPT = String.raw`
param([string]$ReqFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Web.Extensions
$J = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$req = $J.DeserializeObject([IO.File]::ReadAllText($ReqFile))
# Win32 calls, JSON and menus in one small C# class, compiled once per script version and cached next to it.
$Native = @'
using System; using System.Collections; using System.Collections.Generic; using System.Globalization; using System.Runtime.InteropServices; using System.Text;
public static class PiWin {
	delegate bool EnumProc(IntPtr h, IntPtr l);
	[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
	[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr h);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int InternalGetWindowText(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr h);
	[DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr m);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetMenuString(IntPtr m, uint id, StringBuilder s, int n, uint f);
	[DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr m, int pos);
	[DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr m, uint id, uint f);
	[DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr m, int pos);
	[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
	// Visible titled top-level windows in z-order: handle, title, class, pid. InternalGetWindowText never waits on a frozen window; frozen ones are left out.
	public static List<object[]> Windows() {
		var list = new List<object[]>();
		EnumWindows(delegate (IntPtr h, IntPtr l) {
			if (!IsWindowVisible(h) || IsHungAppWindow(h)) return true;
			var t = new StringBuilder(512); InternalGetWindowText(h, t, 512);
			if (t.Length == 0) return true;
			var c = new StringBuilder(256); GetClassName(h, c, 256);
			uint pid; GetWindowThreadProcessId(h, out pid);
			list.Add(new object[] { h, t.ToString(), c.ToString(), (int)pid });
			return true;
		}, IntPtr.Zero);
		return list;
	}
	public static string Json(object o) { var sb = new StringBuilder(); W(o, sb); return sb.ToString(); }
	static void W(object o, StringBuilder sb) {
		var p = o as System.Management.Automation.PSObject; if (p != null) o = p.BaseObject;
		if (o == null) { sb.Append("null"); return; }
		if (o is bool) { sb.Append((bool)o ? "true" : "false"); return; }
		if (o is string || o is char || o is Enum) { S(o.ToString(), sb); return; }
		if (o is IntPtr) { sb.Append(((IntPtr)o).ToInt64()); return; }
		if (o is double || o is float) { var d = Convert.ToDouble(o); sb.Append(double.IsNaN(d) || double.IsInfinity(d) ? "0" : d.ToString("R", CultureInfo.InvariantCulture)); return; }
		if (o.GetType().IsPrimitive || o is decimal) { sb.Append(Convert.ToString(o, CultureInfo.InvariantCulture)); return; }
		var map = o as IDictionary;
		if (map != null) { sb.Append('{'); var first = true; foreach (DictionaryEntry e in map) { if (!first) sb.Append(','); first = false; S(Convert.ToString(e.Key), sb); sb.Append(':'); W(e.Value, sb); } sb.Append('}'); return; }
		var list = o as IEnumerable;
		if (list != null) { sb.Append('['); var first = true; foreach (var x in list) { if (!first) sb.Append(','); first = false; W(x, sb); } sb.Append(']'); return; }
		S(o.ToString(), sb);
	}
	static void S(string s, StringBuilder sb) {
		sb.Append('"');
		foreach (var c in s) { if (c == '"') sb.Append("\\\""); else if (c == '\\') sb.Append("\\\\"); else if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c); }
		sb.Append('"');
	}
}
'@
$dll = [IO.Path]::ChangeExtension($PSCommandPath, '.dll')
if (-not (Test-Path $dll)) { $tmp = "$dll.$PID"; Add-Type -TypeDefinition $Native -OutputAssembly $tmp -ReferencedAssemblies ([psobject].Assembly.Location); try { Move-Item $tmp $dll -ErrorAction Stop } catch { $dll = $tmp } }
Add-Type -Path $dll
function Finish($o) { [IO.File]::WriteAllText($req['out'], [PiWin]::Json($o)); exit 0 }
trap { Finish @{ error = $_.Exception.Message } }
function Arg($k, $d) { if ($req.ContainsKey($k) -and $null -ne $req[$k]) { $req[$k] } else { $d } }

$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$Walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$Root = $AE::RootElement
$op = Arg 'op' ''
$NotSupported = $AE::NotSupported

# Top-level windows grouped by process name, in z-order; the taskbar and desktop are not app windows.
# Listed through Win32: UI Automation's own window list waits ~10 s on each frozen window.
$skip = 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW'
$names = @{}
function ProcName($id) { if (-not $names.ContainsKey($id)) { $names[$id] = try { [Diagnostics.Process]::GetProcessById($id).ProcessName } catch { "pid $id" } }; $names[$id] }
function Load {
	$script:frontH = [PiWin]::GetForegroundWindow()
	$script:frontPid = -1
	$script:groups = [ordered]@{}
	foreach ($w in [PiWin]::Windows()) {
		if ($skip -contains $w[2]) { continue }
		$e = @{ h = $w[0]; name = $w[1]; pid = $w[3] }
		if ($e.h -eq $script:frontH) { $script:frontPid = $e.pid }
		$n = ProcName $e.pid
		if (-not $script:groups.Contains($n)) { $script:groups[$n] = @{ name = $n; pid = $e.pid; pids = New-Object Collections.ArrayList; wins = New-Object Collections.ArrayList } }
		$g = $script:groups[$n]
		if ($g.pids -notcontains $e.pid) { [void]$g.pids.Add($e.pid) }
		[void]$g.wins.Add($e)
	}
}
function Info($g) { @{ name = $g.name; bundle = ''; pid = $g.pid; front = $g.pids -contains $script:frontPid; windows = @($g.wins | ForEach-Object { $_.name }) } }
Load
if ($op -eq 'apps') { Finish @{ apps = @($groups.Values | ForEach-Object { Info $_ }) } }

# The app: a pid or an exact process name, else a process name or window title containing it.
$want = ([string](Arg 'app' '')).ToLower()
function Pick {
	$found = @($script:groups.Values | Where-Object { $_.name.ToLower() -eq $want -or @($_.pids | ForEach-Object { "$_" }) -contains $want })
	if (-not $found.Count) { $found = @($script:groups.Values | Where-Object { $_.name.ToLower().Contains($want) -or @($_.wins | Where-Object { $_.name.ToLower().Contains($want) }).Count }) }
	if (-not $want -or $found.Count -ne 1) {
		Finish @{ error = $(if ($found.Count) { "several apps match ""$want""" } else { "no app with a window matches ""$want"" (windows that are not responding are left out)" }); apps = @($(if ($found.Count) { $found } else { $script:groups.Values }) | ForEach-Object { Info $_ }) }
	}
	$script:G = $found[0]
}
Pick
function Titles { @($G.wins | ForEach-Object { $_.name }) }
# The window: exact title, else title containing it, else the app's window in front, else its topmost.
function Win($name) {
	$all = @($G.wins); $hit = $null
	if ($name) { $low = $name.ToLower(); $hit = @(@($all | Where-Object { $_.name -eq $name }) + @($all | Where-Object { $_.name.ToLower().Contains($low) }))[0] }
	else { $hit = @($all | Where-Object { $_.h -eq $frontH })[0]; if (-not $hit) { $hit = $all[0] } }
	if ($hit) { $AE::FromHandle($hit.h) } else { $null }
}

$Props = @($AE::ControlTypeProperty, $AE::NameProperty, $AE::HelpTextProperty, $AE::AutomationIdProperty, $AE::BoundingRectangleProperty, $AE::IsEnabledProperty, [System.Windows.Automation.ValuePatternIdentifiers]::ValueProperty, [System.Windows.Automation.TogglePatternIdentifiers]::ToggleStateProperty)
function Prop($e, $p, $cached) {
	$v = if ($cached) { $e.GetCachedPropertyValue($p, $true) } else { $e.GetCurrentPropertyValue($p, $true) }
	if ([object]::ReferenceEquals($v, $NotSupported)) { $null } else { $v }
}
function Node($e, $c) {
	$r = Prop $e $Props[4] $c
	$frame = if ($r -and -not $r.IsEmpty) { @{ x = $r.X; y = $r.Y; width = $r.Width; height = $r.Height } } else { @{ x = 0; y = 0; width = 0; height = 0 } }
	$value = Prop $e $Props[6] $c
	if ($null -eq $value) { $t = Prop $e $Props[7] $c; if ($null -ne $t) { $value = @{ 'Off' = '0'; 'On' = '1'; 'Indeterminate' = '2' }["$t"] } }
	$value = [string]$value; if ($value.Length -gt 300) { $value = $value.Substring(0, 300) }
	$role = (Prop $e $Props[0] $c).ProgrammaticName -replace '^ControlType\.', ''
	if (-not $role) { $role = 'Custom' } # newer types (AppBar) have no name in this library
	$n = @{ role = $role; subrole = ''; title = [string](Prop $e $Props[1] $c); desc = [string](Prop $e $Props[2] $c); id = [string](Prop $e $Props[3] $c); value = $value; frame = $frame }
	if ((Prop $e $Props[5] $c) -eq $false) { $n.disabled = $true }
	$n
}
function Kids($e) { $k = New-Object Collections.ArrayList; $c = $Walker.GetFirstChild($e); while ($c) { [void]$k.Add($c); $c = $Walker.GetNextSibling($c) }; ,$k }
function Follow($e, $path) { foreach ($i in $path) { $k = Kids $e; if ($i -lt 0 -or $i -ge $k.Count) { return $null }; $e = $k[$i] }; $e }
function Tree($winName, $rootPath) {
	$w = Win $winName
	if (-not $w) { return @{ error = $(if ($winName) { "no window titled ""$winName""" } else { 'the app has no window' }); windows = @(Titles) } }
	$start = Follow $w $rootPath
	if (-not $start) { return @{ error = 'that element is gone; snapshot again' } }
	# One cross-process read for the whole subtree instead of one per property.
	$cr = New-Object System.Windows.Automation.CacheRequest
	foreach ($p in $Props) { $cr.Add($p) }
	$cr.TreeScope = $Scope::Subtree
	$out = New-Object Collections.ArrayList; $script:cut = $false; $max = [int](Arg 'max' 3000)
	function Walk($e, $path, $depth) {
		if ($out.Count -ge $max) { $script:cut = $true; return }
		if ($depth -gt 60) { return }
		$n = Node $e $true; $n.path = $path; [void]$out.Add($n)
		$i = 0; foreach ($k in $e.CachedChildren) { Walk $k ($path + @($i)) ($depth + 1); $i++ }
	}
	Walk $start.GetUpdatedCache($cr) $rootPath 0
	@{ window = $w.Current.Name; windows = @(Titles); nodes = $out; cut = $script:cut; front = $G.pids -contains $frontPid }
}
# An element by its path, checked against what the snapshot saw there; a moved one is found again by name or id.
function Same($e, $x) { $n = Node $e $false; $n.role -eq $x['role'] -and $n.title -eq $x['title'] -and $n.desc -eq $x['desc'] -and $n.id -eq $x['id'] }
function Resolve {
	$w = Win (Arg 'win' ''); if (-not $w) { $w = Win '' } # titles change (Explorer shows the folder); Same still guards
	if (-not $w) { Finish @{ error = 'that window is gone; snapshot again' } }
	$script:RW = $w
	$x = Arg 'expect' @{}
	$e = Follow $w @(Arg 'path' @())
	if ($e -and (Same $e $x)) { return $e }
	$cond = if ($x['title']) { New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $x['title']) } elseif ($x['id']) { New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, $x['id']) } else { $null }
	if ($cond) { foreach ($c in $w.FindAll($Scope::Descendants, $cond)) { if (Same $c $x) { return $c } } }
	Finish @{ error = 'that element is gone; snapshot again' }
}
function Pat($e, $p) { $o = $null; if ($e.TryGetCurrentPattern($p, [ref]$o)) { $o } else { $null } }
function After($o) {
	$s = [int](Arg 'settleMs' 500)
	if ($s -le 0) { Finish $o }
	Start-Sleep -Milliseconds $s
	Load; Pick # a dialog the action opened is a new window
	$t = Tree (Arg 'scope' '') @()
	foreach ($k in $o.Keys) { $t[$k] = $o[$k] }
	Finish $t
}
# Windows gives key presses only to the window in front: bring it there, check it got there, give the user's window back after.
function Keys($send, $target, $w, $exact) {
	Add-Type -AssemblyName System.Windows.Forms
	$before = $frontH; $h = [IntPtr]$w.Current.NativeWindowHandle
	$wp = Pat $w ([System.Windows.Automation.WindowPatternIdentifiers]::Pattern)
	if ($wp -and "$($wp.Current.WindowVisualState)" -eq 'Minimized') { $wp.SetWindowVisualState('Normal') }
	$target.SetFocus(); Start-Sleep -Milliseconds 150
	$ok = [PiWin]::GetForegroundWindow() -eq $h
	if ($ok -and $exact) { $now = try { $AE::FocusedElement } catch { $null }; $ok = $now -and $now.Equals($target) }
	if (-not $ok) { Finish @{ error = 'Windows did not move the focus there, so no keys were sent (they would have gone to another window or field).' } }
	[System.Windows.Forms.SendKeys]::SendWait($send)
	if ($before -ne [IntPtr]::Zero -and $before -ne $h) { Start-Sleep -Milliseconds 200; try { $AE::FromHandle($before).SetFocus() } catch {} }
}
# Classic Win32 menu bars only: read without opening them, run by posting the item's command.
# shortcut: apps that fill a menu when it opens (WM_INITMENUPOPUP) show stale items and states; open it with snapshot/press if that matters.
function Menus {
	$w = Win (Arg 'scope' ''); $h = [IntPtr]$w.Current.NativeWindowHandle
	$bar = [PiWin]::GetMenu($h)
	if ($bar -eq [IntPtr]::Zero) { Finish @{ error = 'this window has no classic menu bar (only those can be listed): snapshot shows its MenuItem elements; press one to open it' } }
	$items = New-Object Collections.ArrayList
	function WalkMenu($m, $trail) {
		for ($i = 0; $i -lt [PiWin]::GetMenuItemCount($m); $i++) {
			$sb = New-Object Text.StringBuilder 512
			[void][PiWin]::GetMenuString($m, [uint32]$i, $sb, 512, 0x400)
			$parts = $sb.ToString().Split([char]9, 2)
			$label = ($parts[0] -replace '&&', [char]1 -replace '&', '' -replace [char]1, '&').Trim()
			if (-not $label) { continue }
			$here = @($trail) + $label
			$sub = [PiWin]::GetSubMenu($m, $i)
			if ($sub -ne [IntPtr]::Zero) { WalkMenu $sub $here; continue }
			$st = [PiWin]::GetMenuState($m, [uint32]$i, 0x400)
			$key = if ($parts.Count -gt 1) { ($parts[1].Trim().ToLower() -replace '\s*\+\s*', '+') } else { '' }
			[void]$items.Add(@{ path = $here; enabled = -not ($st -band 3); mark = [bool]($st -band 8); hotkey = $key; cmd = [long][PiWin]::GetMenuItemID($m, $i) })
		}
	}
	WalkMenu $bar @()
	@{ items = $items; hwnd = $h }
}
function Norm($s) { ([string]$s).ToLower().Replace([string][char]0x2026, '...').Trim() }

switch ($op) {
	'tree' { Finish (Tree (Arg 'window' '') @(Arg 'root' @())) }
	'press' {
		$e = Resolve; $orig = $e
		$selectable = 'ListItem', 'TreeItem', 'DataItem', 'TabItem', 'RadioButton'
		# Text inside a row or cell: press what holds it. Rows select (never open), like a click.
		for ($i = 0; $i -lt 4; $i++) {
			$role = $e.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
			$sel = Pat $e ([System.Windows.Automation.SelectionItemPatternIdentifiers]::Pattern)
			$inv = Pat $e ([System.Windows.Automation.InvokePatternIdentifiers]::Pattern)
			$tog = Pat $e ([System.Windows.Automation.TogglePatternIdentifiers]::Pattern)
			$exp = Pat $e ([System.Windows.Automation.ExpandCollapsePatternIdentifiers]::Pattern)
			if ($sel -and $selectable -contains $role) { $sel.Select(); After @{ did = 'select' } }
			if ($inv) { $inv.Invoke(); After @{ did = 'press' } }
			if ($tog) { $tog.Toggle(); After @{ did = 'toggle' } }
			if ($sel) { $sel.Select(); After @{ did = 'select' } }
			if ($exp) { if ("$($exp.Current.ExpandCollapseState)" -eq 'Collapsed') { $exp.Expand() } else { $exp.Collapse() }; After @{ did = 'expand' } }
			$up = $Walker.GetParent($e)
			if (-not $up -or $Root.Equals($up)) { break }
			$e = $up
		}
		# A classic Win32 button without UIA patterns (a launcher's error box): BM_CLICK clicks it without moving the mouse.
		$h = $orig.Current.NativeWindowHandle
		if ($h -ne 0) { $r = $orig.Current.BoundingRectangle; [void][PiWin]::PostMessage([IntPtr]$h, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero); After @{ did = 'click'; at = @(($r.X + $r.Width / 2), ($r.Y + $r.Height / 2)) } }
		Finish @{ error = 'this element cannot be pressed (it has no invoke, toggle, select or expand action)' }
	}
	'type' {
		$e = Resolve
		if ($e.Current.IsPassword) { Finish @{ error = 'password fields are refused' } }
		$v = Pat $e ([System.Windows.Automation.ValuePatternIdentifiers]::Pattern)
		if (-not $v -or $v.Current.IsReadOnly) { Finish @{ error = 'this element has no editable text value; press it, or use key' } }
		$v.SetValue([string](Arg 'text' ''))
		if (Arg 'submit' $false) { Keys '{ENTER}' $e $RW $true }
		After @{ did = 'type' }
	}
	'key' {
		$w = Win (Arg 'scope' ''); if (-not $w) { Finish @{ error = 'the app has no window' } }
		Keys (Arg 'send' '') $w $w $false
		After @{ did = 'key' }
	}
	'menus' { $m = Menus; Finish @{ items = $m.items; front = $G.pids -contains $frontPid } }
	'menu' {
		$want = @(@(Arg 'path' @()) | ForEach-Object { Norm $_ })
		$m = Menus
		$hit = @($m.items | Where-Object { $p = @($_.path | ForEach-Object { Norm $_ }); ($p -join '>') -eq ($want -join '>') })[0]
		if (-not $hit) { Finish @{ error = "no menu item ""$($want -join ' > ')""" } }
		if (-not $hit.enabled) { Finish @{ error = """$($want -join ' > ')"" is disabled right now" } }
		[void][PiWin]::PostMessage($m.hwnd, 0x111, [IntPtr]$hit.cmd, [IntPtr]::Zero)
		After @{ did = 'menu' }
	}
}
Finish @{ error = "unknown op $op" }
`;

export async function runWinHelper(exec: Exec, req: Record<string, unknown>, signal?: AbortSignal) {
	const script = path.join(os.tmpdir(), `pi-app-helper-${createHash("sha256").update(WIN_SCRIPT).digest("hex").slice(0, 16)}.ps1`);
	if (!existsSync(script)) await writeFile(script, WIN_SCRIPT);
	const base = path.join(os.tmpdir(), `app-act-${process.pid}-${Date.now()}`), file = `${base}-req.json`, out = `${base}-out.json`;
	await writeFile(file, JSON.stringify({ ...req, out }));
	try {
		const r = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, file], { timeout: 60_000, signal });
		const res = JSON.parse(await readFile(out, "utf8").catch(() => "null"));
		// shortcut: Invoke on a button that opens a modal dialog can wait for that dialog in some apps; the timeout ends it, the press did happen.
		if (!res) throw new Error(`The Windows UI Automation helper gave no answer${r.killed ? " (timed out: if the press opened a dialog, snapshot to see it)" : ""}: ${String(r.stderr || r.stdout || "").trim().slice(-800)}`);
		return res;
	} finally { for (const f of [file, out]) await rm(f, { force: true }); }
}

const NAMES: Record<string, string> = { return: "{ENTER}", enter: "{ENTER}", tab: "{TAB}", escape: "{ESC}", esc: "{ESC}", space: " ", backspace: "{BACKSPACE}", delete: "{DELETE}", forwarddelete: "{DELETE}", insert: "{INSERT}", home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}", up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}" };
const MODS: Record<string, string> = { ctrl: "^", control: "^", shift: "+", alt: "%" };
/** "ctrl+shift+k" to SendKeys form ("^+k"). */
export function winKeys(keys: string) {
	const parts = keys.toLowerCase().split("+").map(p => p.trim()).filter(Boolean), key = parts.pop() ?? "";
	const mods = parts.map(m => { if (!(m in MODS)) throw new Error(`Unknown modifier "${m}" (use ctrl, shift, alt).`); return MODS[m]; }).join("");
	let k = NAMES[key] ?? "";
	if (!k && /^f([1-9]|1[0-6])$/.test(key)) k = `{${key.toUpperCase()}}`;
	if (!k && key.length === 1) k = /[+^%~(){}[\]]/.test(key) ? `{${key}}` : key;
	if (!k) throw new Error(`Unknown key "${key}" (letters, digits, return, escape, tab, space, backspace, delete, arrows, f1-f16, home, end, pageup, pagedown, insert).`);
	return mods + k;
}
