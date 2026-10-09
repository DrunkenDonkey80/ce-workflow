import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// One PowerShell/C# helper: window enumeration, PrintWindow capture (minimized windows included) and PNG crop/downscale.
const source = String.raw`
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
public class ScreenRead {
 public class Window { public long handle; public uint pid; public string title; public bool minimized; }
 public class Shot { public int width,height,sourceWidth,sourceHeight; public double scale; public bool uniform; }
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int l,t,r,b; }
 delegate bool Callback(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr p);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
 [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
 [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
 [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
 [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
 [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out Rect r, int size);
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
 [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int size);
 public static Window[] Find(long handle, uint pid, string title) {
  SetThreadDpiAwarenessContext(new IntPtr(-4)); var list=new List<Window>();
  EnumWindows((h,p)=> {
   int cloaked; if(!IsWindowVisible(h) || (DwmGetWindowAttribute(h,14,out cloaked,4)==0 && cloaked!=0)) return true;
   var s=new StringBuilder(256); GetWindowText(h,s,256); uint id; GetWindowThreadProcessId(h,out id);
   if(s.Length>0 && (handle==0 || h.ToInt64()==handle) && (pid==0 || id==pid) && (String.IsNullOrEmpty(title) || s.ToString().IndexOf(title,StringComparison.OrdinalIgnoreCase)>=0))
    list.Add(new Window { handle=h.ToInt64(), pid=id, title=s.ToString(), minimized=IsIconic(h) });
   return list.Count<200; },IntPtr.Zero);
  return list.ToArray();
 }
 public static Shot Capture(long handle, int[] region, int maxEdge, bool minimize, string file) {
  var h=new IntPtr(handle);
  if(!IsWindow(h) || h==GetDesktopWindow() || h==GetShellWindow()) throw new Exception("Not an application window.");
  SetThreadDpiAwarenessContext(new IntPtr(-4));
  bool wasMin=IsIconic(h); int ex=GetWindowLong(h,-20), on=1, off=0;
  try {
   if(wasMin) { // restore fully transparent and without activation, so PrintWindow renders current content
    DwmSetWindowAttribute(h,3,ref on,4); SetWindowLong(h,-20,ex|0x80000); SetLayeredWindowAttributes(h,0,0,2);
    ShowWindow(h,4); System.Threading.Thread.Sleep(150);
   }
   Rect phys, ext, log; GetWindowRect(h,out phys); if(DwmGetWindowAttribute(h,9,out ext,16)!=0) ext=phys;
   var old=SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(h)); GetWindowRect(h,out log); SetThreadDpiAwarenessContext(old);
   int w=log.r-log.l, ht=log.b-log.t; // DPI-unaware windows render at logical size
   if(w<1 || ht<1 || (long)w*ht>40000000) throw new Exception("Window has no capturable size.");
   double k=(double)w/Math.Max(1,phys.r-phys.l);
   using(var bmp=new Bitmap(w,ht,PixelFormat.Format32bppArgb)) {
    using(var g=Graphics.FromImage(bmp)) { var dc=g.GetHdc(); try { if(!PrintWindow(h,dc,2)) throw new Exception("Window did not render (PrintWindow failed)."); } finally { g.ReleaseHdc(dc); } }
    // drop the invisible DWM resize border
    int x0=Math.Max(0,(int)Math.Round((ext.l-phys.l)*k)), y0=Math.Max(0,(int)Math.Round((ext.t-phys.t)*k));
    int x1=Math.Min(w,w-(int)Math.Round((phys.r-ext.r)*k)), y1=Math.Min(ht,ht-(int)Math.Round((phys.b-ext.b)*k));
    var frame=(x1>x0 && y1>y0) ? Rectangle.FromLTRB(x0,y0,x1,y1) : new Rectangle(0,0,w,ht);
    return Save(bmp,frame,region,maxEdge,file);
   }
  } finally {
   if(wasMin || minimize) ShowWindow(h,7);
   if(wasMin) { SetWindowLong(h,-20,ex); DwmSetWindowAttribute(h,3,ref off,4); }
  }
 }
 public static Shot ProcessFile(string input, int[] region, int maxEdge, string file) {
  using(var bmp=new Bitmap(input)) return Save(bmp,new Rectangle(0,0,bmp.Width,bmp.Height),region,maxEdge,file);
 }
 static Shot Save(Bitmap src, Rectangle frame, int[] region, int maxEdge, string file) {
  var r=frame;
  if(region!=null && region.Length==4) {
   if(region[0]<0 || region[1]<0 || region[2]<1 || region[3]<1 || (long)region[0]+region[2]>frame.Width || (long)region[1]+region[3]>frame.Height) throw new Exception("region must lie inside the "+frame.Width+"x"+frame.Height+" source image.");
   r=new Rectangle(frame.X+region[0],frame.Y+region[1],region[2],region[3]);
  }
  double s=Math.Min(1.0,(double)maxEdge/Math.Max(r.Width,r.Height));
  int w=Math.Max(1,(int)Math.Round(r.Width*s)), ht=Math.Max(1,(int)Math.Round(r.Height*s));
  bool uniform=true;
  using(var dst=new Bitmap(w,ht,PixelFormat.Format32bppArgb)) {
   using(var g=Graphics.FromImage(dst)) using(var a=new ImageAttributes()) {
    g.InterpolationMode=InterpolationMode.HighQualityBicubic; g.PixelOffsetMode=PixelOffsetMode.HighQuality; a.SetWrapMode(WrapMode.TileFlipXY);
    g.DrawImage(src,new Rectangle(0,0,w,ht),r.X,r.Y,r.Width,r.Height,GraphicsUnit.Pixel,a);
   }
   int first=dst.GetPixel(0,0).ToArgb();
   for(int y=0;y<ht && uniform;y+=Math.Max(1,ht/32)) for(int x=0;x<w;x+=Math.Max(1,w/32)) if(dst.GetPixel(x,y).ToArgb()!=first) { uniform=false; break; }
   dst.Save(file,ImageFormat.Png);
  }
  return new Shot { width=w, height=ht, sourceWidth=frame.Width, sourceHeight=frame.Height, scale=Math.Round(s,4), uniform=uniform };
 }
}
`;

type Exec = (command: string, args: string[], options: { timeout: number; signal?: AbortSignal }) => Promise<{ code?: number; killed?: boolean; stdout?: string; stderr?: string }>;
export type ScreenReadArgs = {
	target: "window" | "browser" | "android";
	window?: { title?: string; pid?: number; handle?: number; minimize?: boolean };
	browser?: { url?: string; selector?: string; full?: boolean; session?: string };
	android?: { device?: string };
	region?: number[];
	maxEdge?: number;
};

const SCRIPT = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing; Add-Type -TypeDefinition @'\n${source}\n'@ -ReferencedAssemblies System.Drawing
try {
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SCREEN_READ_ARGS))|ConvertFrom-Json
if($p.op -eq 'window') {
 $m=@([ScreenRead]::Find([long]$p.handle,[uint32]$p.pid,[string]$p.title))
 if($p.list -or $m.Count -ne 1) { ConvertTo-Json -InputObject @{matches=$m} -Compress -Depth 3 }
 else { ConvertTo-Json -InputObject @{window=$m[0]; shot=[ScreenRead]::Capture($m[0].handle,[int[]]$p.region,[int]$p.maxEdge,[bool]$p.minimize,$p.file)} -Compress -Depth 3 }
} else {
 $exe=(Get-Command $p.exe -CommandType Application -ErrorAction Stop)[0].Source
 $i=0
 foreach($a in $p.runs) {
  # Output goes to files: a daemon spawned by the tool (agent-browser, adb) inherits pipes and would block reading them to EOF.
  $log="$($p.raw).$i"; $i++
  $q=@($a | ForEach-Object { if($_ -match '[\s&|<>^()]') { '"'+$_+'"' } else { $_ } })
  $pr=Start-Process -FilePath $exe -ArgumentList $q -NoNewWindow -PassThru -RedirectStandardOutput "$log.out" -RedirectStandardError "$log.err"
  $null=$pr.Handle; if(-not $pr.WaitForExit(90000)) { throw "$($p.exe) $($a -join ' ') timed out" }
  if($pr.ExitCode) { throw "$($p.exe) $($a -join ' ') failed: $(Get-Content -Raw -Encoding UTF8 "$log.out") $(Get-Content -Raw -Encoding UTF8 "$log.err")" }
 }
 $shot=[ScreenRead]::ProcessFile($p.raw,[int[]]$p.region,[int]$p.maxEdge,$p.file)
 Remove-Item "$($p.raw)*" -ErrorAction SilentlyContinue # logs a running daemon still holds stay behind
 ConvertTo-Json -InputObject @{shot=$shot} -Compress -Depth 3
}
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;

export function screenReadPlan(args: ScreenReadArgs, file: string) {
	const region = args.region;
	if (region !== undefined && (!Array.isArray(region) || region.length !== 4 || region.some(v => !Number.isSafeInteger(v)) || region[0] < 0 || region[1] < 0 || region[2] < 1 || region[3] < 1)) throw new Error("region must be [x, y, width, height] in non-negative integer source pixels.");
	const maxEdge = Math.min(4096, Math.max(64, Math.round(args.maxEdge ?? 1024)));
	const base = { region, maxEdge, file };
	if (args.target === "window") {
		const w = args.window ?? {};
		return { ...base, op: "window", title: w.title ?? "", pid: w.pid ?? 0, handle: w.handle ?? 0, minimize: !!w.minimize, list: !w.title && !w.pid && !w.handle };
	}
	const raw = file.replace(/\.png$/, "-raw.png");
	if (args.target === "browser") {
		const b = args.browser ?? {}, session = b.session ? ["--session", b.session] : [];
		if ([b.url, b.selector, b.session].some(v => v?.includes('"'))) throw new Error("browser url/selector/session cannot contain double quotes; use single quotes in selectors.");
		const runs = [...(b.url ? [[...session, "open", b.url]] : []), [...session, "screenshot", ...(b.selector ? [b.selector] : []), raw, ...(b.full ? ["--full"] : [])]];
		return { ...base, op: "file", exe: "agent-browser", runs, raw };
	}
	if (args.target === "android") return { ...base, op: "file", exe: "android", runs: [["screen", "capture", ...(args.android?.device ? [`--device=${args.android.device}`] : []), `--output=${raw}`]], raw };
	throw new Error("target must be window, browser or android.");
}

export async function screenRead(exec: Exec, args: ScreenReadArgs, signal?: AbortSignal, dir = path.join(os.tmpdir(), "pi-screen-read")) {
	// ponytail: Windows-only (PowerShell + System.Drawing); port Save() to Photon/sharp if agents need it elsewhere.
	if (process.platform !== "win32") throw new Error("screen_read needs Windows; elsewhere use agent-browser screenshot or android screen capture directly.");
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}.png`);
	const plan = screenReadPlan(args, file);
	// env, not argv: no quoting issues; spawn copies it synchronously, so parallel calls cannot mix it up
	process.env.SCREEN_READ_ARGS = Buffer.from(JSON.stringify(plan), "utf8").toString("base64");
	const pending = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(SCRIPT, "utf16le").toString("base64")], { timeout: 120_000, signal });
	delete process.env.SCREEN_READ_ARGS;
	const result = await pending;
	if (result.killed || result.code) throw new Error(result.killed ? "screen_read timed out." : String(result.stderr || result.stdout || "screen_read failed").trim().slice(-1500));
	let out;
	try { out = JSON.parse(result.stdout ?? ""); } catch { throw new Error(`screen_read returned invalid output: ${String(result.stdout).slice(0, 500)}`); }
	if (out.matches) return { matches: [out.matches].flat().filter(Boolean) as { handle: number; pid: number; title: string; minimized: boolean }[] };
	return { file, window: out.window, ...out.shot as { width: number; height: number; sourceWidth: number; sourceHeight: number; scale: number; uniform: boolean } };
}

export const screenReadTool = (exec: Exec) => ({
	name: "screen_read",
	label: "Screen read",
	promptSnippet: "Capture an app window (even minimized), headless browser page/element or Android screen as a small cropped image for visual testing",
	promptGuidelines: [
		"For UI testing, launch apps minimized and browsers headless (agent-browser); never put test windows on the user's screen. Read them with screen_read.",
		"Prefer text first (agent-browser snapshot/read, android layout); use screen_read for visual checks, starting with a small maxEdge and zooming in with region.",
	],
	description: [
		"Visual read for testing. Returns a PNG downscaled so its longest edge is at most maxEdge (default 1024). Image tokens scale with pixel count, so ask for the least you need: maxEdge 512 shows layout; then zoom with region [x, y, width, height] in SOURCE pixels (reported in every result) for full detail of one area.",
		"Prefer text when it answers the question: agent-browser snapshot/read for web pages, android layout for devices. Use this for layout, colors, rendering and canvas.",
		"target=window: a Windows app window by title substring, pid or handle; omit all three to list windows. Works on minimized and background windows without focusing or showing them; launch test apps minimized. minimize=true minimizes a window that popped up after capturing it. Capture only the app under test, not the user's own windows.",
		"target=browser: the current agent-browser page (headless; never use --headed for checks). url opens it first; selector captures one element; full captures the whole page; session picks an agent-browser session.",
		"target=android: android screen capture of the device (serial from `adb devices`; omit when only one is attached).",
	].join("\n"),
	parameters: {
		type: "object", additionalProperties: false, required: ["target"],
		properties: {
			target: { type: "string", enum: ["window", "browser", "android"] },
			window: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, pid: { type: "integer" }, handle: { type: "integer" }, minimize: { type: "boolean" } } },
			browser: { type: "object", additionalProperties: false, properties: { url: { type: "string" }, selector: { type: "string" }, full: { type: "boolean" }, session: { type: "string" } } },
			android: { type: "object", additionalProperties: false, properties: { device: { type: "string" } } },
			region: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4, description: "[x, y, width, height] crop in source pixels" },
			maxEdge: { type: "integer", minimum: 64, maximum: 4096, description: "Longest output edge in pixels (default 1024)" },
		},
	},
	async execute(_id: string, args: ScreenReadArgs, signal?: AbortSignal) {
		const shot = await screenRead(exec, args, signal);
		if ("matches" in shot) {
			const lines = shot.matches.map(w => `handle=${w.handle} pid=${w.pid}${w.minimized ? " minimized" : ""} ${w.title}`);
			const text = shot.matches.length ? `${shot.matches.length} window(s); pass handle, pid or a unique title:\n${lines.join("\n")}` : "No matching window.";
			return { content: [{ type: "text", text }], details: shot };
		}
		const what = shot.window ? `Window "${shot.window.title}" (pid ${shot.window.pid}, handle ${shot.window.handle}${shot.window.minimized ? ", minimized" : ""})` : args.target === "browser" ? "Browser" : "Android screen";
		const text = `${what}: ${shot.width}x${shot.height} PNG${shot.scale < 1 ? `, scaled x${shot.scale}` : ""} from ${args.region ? `region ${args.region.join(",")} of ` : ""}${shot.sourceWidth}x${shot.sourceHeight} source. ${shot.uniform ? "WARNING: the image is one flat color; the app may not render off-screen. " : ""}File: ${shot.file}`;
		return { content: [{ type: "text", text }, { type: "image", data: (await readFile(shot.file)).toString("base64"), mimeType: "image/png" }], details: shot };
	},
});

export default function screenReadExtension(pi) {
	pi.registerTool?.(screenReadTool(pi.exec.bind(pi)));
}
