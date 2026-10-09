// PrintWindow is app-rendered HWND capture, never desktop pixels; GPU/hidden freshness is not guaranteed.
const source = String.raw`
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
public class Plan3Window {
 public class Window { public long handle; public uint pid; public string title; public int width,height; public bool visible,minimized; }
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int left,top,right,bottom; }
 delegate bool Callback(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr p);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
 [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
 static void DPI() { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) throw new Exception("Cannot establish physical window coordinates."); }
 static Window Describe(IntPtr h) {
  if (!IsWindow(h)) throw new Exception("Selected window no longer exists.");
  if(h==GetDesktopWindow() || h==GetShellWindow()) throw new Exception("Desktop/shell capture is forbidden; select an application window.");
  uint pid; GetWindowThreadProcessId(h,out pid); Rect r;
  if (!GetWindowRect(h,out r)) throw new Exception("Cannot read window bounds.");
  var title=new StringBuilder(256); GetWindowText(h,title,title.Capacity);
  return new Window { handle=h.ToInt64(),pid=pid,title=title.ToString(),width=r.right-r.left,height=r.bottom-r.top,visible=IsWindowVisible(h),minimized=IsIconic(h) };
 }
 public static Window[] List() {
  DPI(); var windows=new List<Window>();
  EnumWindows((h,p)=> { try { var w=Describe(h); if(w.title.Length>0 && w.width>0 && w.height>0) windows.Add(w); } catch {} return windows.Count<256; },IntPtr.Zero);
  return windows.ToArray();
 }
 public static Window Capture(long handle,uint pid,string title,int width,int height,int[] crop,string file) {
  DPI(); var h=new IntPtr(handle); var w=Describe(h);
  if(w.pid!=pid || w.title!=title || w.width!=width || w.height!=height) throw new Exception("Window identity/bounds changed; select again.");
  if(w.minimized) throw new Exception("Minimized window capture is unsupported; no automatic restore/focus.");
  if(width<1 || height<1 || (long)width*height>16000000) throw new Exception("Window too large; bounded capture only.");
  if(crop.Length!=4 || crop[0]<0 || crop[1]<0 || crop[2]<1 || crop[3]<1 || (long)crop[0]+crop[2]>width || (long)crop[1]+crop[3]>height) throw new Exception("Invalid window-relative crop.");
  using(var bitmap=new Bitmap(width,height,PixelFormat.Format32bppArgb)) {
   using(var graphics=Graphics.FromImage(bitmap)) {
    graphics.Clear(Color.Magenta); var dc=graphics.GetHdc();
    try { if(!PrintWindow(h,dc,0)) throw new Exception("Application did not render PrintWindow; provide a screenshot."); }
    finally { graphics.ReleaseHdc(dc); }
   }
   var after=Describe(h);
   if(after.pid!=pid || after.width!=width || after.height!=height || after.title!=w.title) throw new Exception("Window changed during capture; retry selection.");
   using(var clipped=bitmap.Clone(new Rectangle(crop[0],crop[1],crop[2],crop[3]),PixelFormat.Format32bppArgb)) {
    int first=clipped.GetPixel(0,0).ToArgb(); bool varied=false;
    for(int y=0;y<clipped.Height;y+=Math.Max(1,clipped.Height/32)) for(int x=0;x<clipped.Width;x+=Math.Max(1,clipped.Width/32)) if(clipped.GetPixel(x,y).ToArgb()!=first) varied=true;
    if(!varied) throw new Exception("Blank/unrendered/uniform capture; inspect an independently supplied screenshot instead.");
    clipped.Save(file,ImageFormat.Png);
   }
  }
  return w;
 }
}
`;
type WindowTarget = { handle: number; pid: number; title: string; width: number; height: number; visible: boolean; minimized: boolean };
type WindowExec = (command: string, args: string[], options: { timeout: number }) => Promise<{ code?: number; killed?: boolean; stdout?: string; stderr?: string }>;

export function windowCrop(target: WindowTarget, crop?: number[]) {
	if (!target || !Number.isSafeInteger(target.handle) || target.handle <= 0 || !Number.isSafeInteger(target.pid) || target.pid <= 0 || !Number.isSafeInteger(target.width) || !Number.isSafeInteger(target.height) || target.width < 1 || target.height < 1 || target.width * target.height > 16_000_000) throw new Error("Invalid selected HWND/process/physical dimensions.");
	const box = crop ?? [0, 0, target.width, target.height];
	if (!Array.isArray(box) || box.length !== 4 || box.some(value => !Number.isSafeInteger(value)) || box[0] < 0 || box[1] < 0 || box[2] < 1 || box[3] < 1 || box[0] + box[2] > target.width || box[1] + box[3] > target.height) throw new Error("Crop must be x,y,width,height in selected-window physical coordinates.");
	if (target.minimized) throw new Error("Minimized capture unsupported; never silently restore/focus the window.");
	return box;
}
export async function plan3Windows(exec: WindowExec, target?: WindowTarget, file?: string, crop?: number[]) {
	if (process.platform !== "win32") throw new Error("Window capture is Windows-only; supply an image on this platform.");
	const box = target ? windowCrop(target, crop) : undefined;
	const data = Buffer.from(JSON.stringify({ target, file, crop: box }), "utf8").toString("base64");
	const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Drawing; Add-Type -TypeDefinition @'\n${source}\n'@ -ReferencedAssemblies System.Drawing; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))|ConvertFrom-Json; if($p.target){ [Plan3Window]::Capture($p.target.handle,$p.target.pid,$p.target.title,$p.target.width,$p.target.height,[int[]]$p.crop,$p.file)|ConvertTo-Json -Compress } else { ConvertTo-Json -InputObject @([Plan3Window]::List()) -Compress }`;
	const result = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { timeout: 15_000 });
	if (result.killed || result.code) throw new Error(result.killed ? "Window rendering timed out; capture unavailable (no desktop fallback)." : String(result.stderr || "Window capture unavailable").slice(-1000));
	let parsed;
	try { parsed = JSON.parse(result.stdout ?? ""); } catch { throw new Error("Invalid Windows capture output."); }
	if (target) {
		if (parsed.handle !== target.handle || parsed.pid !== target.pid || parsed.width !== target.width || parsed.height !== target.height || parsed.title !== target.title) throw new Error("Window capture returned a different target.");
		return { ...parsed, crop: box, method: "PrintWindow", capturedAt: new Date().toISOString(), limits: "App-rendered pixels; GPU/hidden/occluded freshness unverified. Visually inspect before transfer; no focus/restore/desktop fallback." };
	}
	if (!Array.isArray(parsed) || parsed.length > 256) throw new Error("Invalid/big window list.");
	return parsed;
}
