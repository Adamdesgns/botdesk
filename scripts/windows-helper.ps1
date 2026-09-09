param([switch]$CompileOnly)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
# Input is data on stdin. No command string, Invoke-Expression, clipboard or shell execution.
$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Automation;

public static class BotDeskNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; public POINT(int x,int y) { X=x; Y=y; } }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk,wScan; public uint dwFlags,time; public UIntPtr dwExtraInfo; }
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern uint SendInput(uint count,INPUT[] items,int size);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd,IntPtr dc,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int count);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint threadId);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr obj,int index,StringBuilder info,int bytes,out int needed);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token,int info,IntPtr buffer,int length,out int needed);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid,uint index);
  [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode)] static extern bool WTSQuerySessionInformation(IntPtr server,int session,int info,out IntPtr buffer,out int bytes);
  [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr memory);
  public delegate bool EnumWindowProc(IntPtr hwnd,IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowProc callback,IntPtr data);
  static readonly HashSet<string> Apps = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "msedge","chrome","firefox","notepad" };
  static readonly Regex Denied = new Regex(@"\b(stripe|paypal|venmo|bank(?:ing)?|brokerage|crypto|wallet|password|login|authenticator|uac|regedit|powershell|terminal|devtools)\b|cash\s*app|credit\s*card|sign\s*in|log\s*in|credential\s*manager|1password|bitwarden|lastpass|keepass|user\s*account\s*control|windows\s*(security|defender)|registry\s*editor|task\s*manager|device\s*manager|control\s*panel|group\s*policy|developer\s*tools|command\s*prompt",RegexOptions.IgnoreCase);
  static readonly HashSet<string> SafeKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "ENTER","TAB","ESCAPE","BACKSPACE","DELETE","ARROWUP","ARROWDOWN","ARROWLEFT","ARROWRIGHT","HOME","END","PAGEUP","PAGEDOWN","CTRL+A","CTRL+Z","ALT+LEFT","ALT+RIGHT","F5" };
  static readonly Dictionary<string,ushort> Keys = new Dictionary<string,ushort>(StringComparer.OrdinalIgnoreCase) {
    {"ENTER",0x0D},{"TAB",0x09},{"ESCAPE",0x1B},{"BACKSPACE",0x08},{"DELETE",0x2E},{"ARROWUP",0x26},{"ARROWDOWN",0x28},{"ARROWLEFT",0x25},{"ARROWRIGHT",0x27},{"HOME",0x24},{"END",0x23},{"PAGEUP",0x21},{"PAGEDOWN",0x22},{"F5",0x74},{"CTRL",0x11},{"ALT",0x12},{"A",0x41},{"Z",0x5A},{"LEFT",0x25},{"RIGHT",0x27}
  };
  static Exception Block(string reason) { return new InvalidOperationException(reason); }
  public static void Init() { SetProcessDPIAware(); }
  static string DesktopName(IntPtr handle) {
    if(handle==IntPtr.Zero) return "unknown";
    var text=new StringBuilder(256); int needed;
    return GetUserObjectInformation(handle,2,text,text.Capacity*2,out needed) ? text.ToString().ToLowerInvariant() : "unknown";
  }
  public static string Desktop() {
    IntPtr desktop=IntPtr.Zero, info=IntPtr.Zero;
    try {
      int session=Process.GetCurrentProcess().SessionId, bytes;
      if(session==0 || !WTSQuerySessionInformation(IntPtr.Zero,session,8,out info,out bytes) || bytes<4 || Marshal.ReadInt32(info)!=0) return "unknown";
      desktop=OpenInputDesktop(0,false,1);
      if(DesktopName(desktop)!="default" || DesktopName(GetThreadDesktop(GetCurrentThreadId()))!="default") return "unknown";
      return "default";
    } catch { return "unknown"; }
    finally { if(desktop!=IntPtr.Zero) CloseDesktop(desktop); if(info!=IntPtr.Zero) WTSFreeMemory(info); }
  }
  public static string Integrity(uint pid) {
    IntPtr process=IntPtr.Zero, token=IntPtr.Zero, buffer=IntPtr.Zero;
    try {
      process=OpenProcess(0x1000,false,pid);
      if(process==IntPtr.Zero || !OpenProcessToken(process,8,out token)) return "unknown";
      int needed; GetTokenInformation(token,25,IntPtr.Zero,0,out needed);
      if(needed<=0 || needed>65536) return "unknown";
      buffer=Marshal.AllocHGlobal(needed);
      if(!GetTokenInformation(token,25,buffer,needed,out needed)) return "unknown";
      IntPtr sid=Marshal.ReadIntPtr(buffer); int count=Marshal.ReadByte(GetSidSubAuthorityCount(sid));
      if(count<1) return "unknown";
      int rid=Marshal.ReadInt32(GetSidSubAuthority(sid,(uint)(count-1)));
      if(rid<0x1000) return "untrusted";
      if(rid<0x2000) return "low";
      if(rid==0x2000) return "medium";
      if(rid<0x3000) return "medium-plus";
      if(rid<0x4000) return "high";
      return "system";
    } catch { return "unknown"; }
    finally { if(buffer!=IntPtr.Zero) Marshal.FreeHGlobal(buffer); if(token!=IntPtr.Zero) CloseHandle(token); if(process!=IntPtr.Zero) CloseHandle(process); }
  }
  public static Dictionary<string,object> Describe(IntPtr hwnd,bool automation) {
    uint pid; GetWindowThreadProcessId(hwnd,out pid);
    var title=new StringBuilder(1024); GetWindowText(hwnd,title,title.Capacity);
    string name=""; try { name=Process.GetProcessById((int)pid).ProcessName; } catch { }
    RECT rect; if(!GetWindowRect(hwnd,out rect)) rect=new RECT();
    var result=new Dictionary<string,object> {
      {"handle",hwnd.ToInt64().ToString()},{"processId",(int)pid},{"processName",name},{"title",title.ToString()},
      {"integrity",Integrity(pid)},{"desktop",Desktop()},{"automationChecked",false},{"passwordFocused",true},{"passwordPresent",true},
      {"geometry",new Dictionary<string,object>{{"x",rect.Left},{"y",rect.Top},{"width",rect.Right-rect.Left},{"height",rect.Bottom-rect.Top}}}
    };
    if(automation) {
      try {
        var root=AutomationElement.FromHandle(hwnd);
        if(root==null || root.Current.ProcessId!=(int)pid) return result;
        var password=root.FindFirst(TreeScope.Subtree,new PropertyCondition(AutomationElement.IsPasswordProperty,true));
        var focused=AutomationElement.FocusedElement;
        result["passwordPresent"]=password!=null;
        result["passwordFocused"]=focused==null || focused.Current.IsPassword;
        result["automationChecked"]=true;
      } catch { }
    }
    return result;
  }
  static IntPtr ParseHandle(string value) { long parsed; if(!Int64.TryParse(value,out parsed) || parsed<=0) throw Block("invalid-target"); return new IntPtr(parsed); }
  static void BasicCheck(IntPtr hwnd,uint expectedPid,bool foreground) {
    if(Desktop()!="default") throw Block("desktop-blocked");
    string self=Integrity((uint)Process.GetCurrentProcess().Id);
    if(self!="medium" && self!="low") throw Block("host-integrity-blocked");
    uint pid; GetWindowThreadProcessId(hwnd,out pid);
    if(pid==0 || pid!=expectedPid || !IsWindowVisible(hwnd) || IsIconic(hwnd)) throw Block("target-changed");
    if(foreground && GetForegroundWindow()!=hwnd) throw Block("target-not-foreground");
    var process=Process.GetProcessById((int)pid);
    if(process.SessionId!=Process.GetCurrentProcess().SessionId || !Apps.Contains(process.ProcessName)) throw Block("app-blocked");
    string integrity=Integrity(pid);
    if(integrity!="medium" && integrity!="low") throw Block("target-integrity-blocked");
    var title=new StringBuilder(1024); GetWindowText(hwnd,title,title.Capacity);
    if(title.Length==0 || Denied.IsMatch(title.ToString())) throw Block("sensitive-window");
  }
  static void SensitiveCheck(IntPtr hwnd,uint expectedPid,bool requireFocus) {
    var root=AutomationElement.FromHandle(hwnd);
    if(root==null || root.Current.ProcessId!=(int)expectedPid) throw Block("automation-unavailable");
    if(root.FindFirst(TreeScope.Subtree,new PropertyCondition(AutomationElement.IsPasswordProperty,true))!=null) throw Block("password-control");
    var focused=AutomationElement.FocusedElement;
    if(requireFocus && (focused==null || focused.Current.ProcessId!=(int)expectedPid || focused.Current.IsPassword)) throw Block("focused-control-blocked");
  }
  static IntPtr Check(string handle,uint pid,bool foreground) {
    IntPtr hwnd=ParseHandle(handle); BasicCheck(hwnd,pid,foreground); SensitiveCheck(hwnd,pid,foreground); BasicCheck(hwnd,pid,foreground); return hwnd;
  }
  static void ModifiersReleased() {
    foreach(int vk in new int[]{0x10,0x11,0x12,0x5B,0x5C}) if((GetAsyncKeyState(vk)&0x8000)!=0) throw Block("physical-modifier-held");
  }
  static void Emit(INPUT[] items) { if(SendInput((uint)items.Length,items,Marshal.SizeOf(typeof(INPUT)))!=(uint)items.Length) throw Block("input-incomplete"); }
  public static Dictionary<string,object> Foreground() { return Describe(GetForegroundWindow(),true); }
  public static List<Dictionary<string,object>> Windows() {
    var windows=new List<Dictionary<string,object>>();
    if(Desktop()!="default") return windows;
    EnumWindows(delegate(IntPtr hwnd,IntPtr unused) {
      if(windows.Count>=100) return false;
      try {
        uint pid; GetWindowThreadProcessId(hwnd,out pid); BasicCheck(hwnd,pid,false);
        var item=Describe(hwnd,true);
        if((bool)item["automationChecked"] && !(bool)item["passwordPresent"]) windows.Add(item);
      } catch { }
      return true;
    },IntPtr.Zero);
    return windows;
  }
  public static void Focus(string handle,uint pid) {
    IntPtr hwnd=Check(handle,pid,false);
    if(!SetForegroundWindow(hwnd)) throw Block("focus-refused");
    Check(handle,pid,true);
  }
  public static Dictionary<string,object> Capture(string handle,uint pid) {
    IntPtr hwnd=Check(handle,pid,true); RECT before;
    if(!GetWindowRect(hwnd,out before)) throw Block("geometry-unavailable");
    int width=before.Right-before.Left, height=before.Bottom-before.Top;
    if(width<1 || height<1 || width>7680 || height>4320 || (long)width*height>16000000) throw Block("capture-size-blocked");
    string image;
    using(var bitmap=new Bitmap(width,height,PixelFormat.Format32bppArgb)) {
      using(var graphics=Graphics.FromImage(bitmap)) {
        IntPtr dc=graphics.GetHdc();
        try { if(!PrintWindow(hwnd,dc,2)) throw Block("window-capture-unavailable"); }
        finally { graphics.ReleaseHdc(dc); }
      }
      using(var stream=new MemoryStream()) { bitmap.Save(stream,ImageFormat.Png); if(stream.Length>16000000) throw Block("capture-size-blocked"); image=Convert.ToBase64String(stream.ToArray()); }
    }
    Check(handle,pid,true); RECT after; GetWindowRect(hwnd,out after);
    if(before.Left!=after.Left || before.Top!=after.Top || before.Right!=after.Right || before.Bottom!=after.Bottom) throw Block("target-moved-during-capture");
    var window=Describe(hwnd,true);
    if(!(bool)window["automationChecked"] || (bool)window["passwordPresent"] || (bool)window["passwordFocused"]) throw Block("password-control");
    return new Dictionary<string,object>{{"ok",true},{"window",window},{"geometry",window["geometry"]},{"image",new Dictionary<string,object>{{"mimeType","image/png"},{"data",image},{"width",width},{"height",height}}}};
  }
  public static Dictionary<string,object> Snapshot(string handle,uint pid) {
    IntPtr hwnd=Check(handle,pid,true);
    var controls=new List<Dictionary<string,object>>();
    var root=AutomationElement.FromHandle(hwnd);
    // A bounded walker avoids building a huge descendant collection for a large document.
    var stack=new Stack<AutomationElement>(); stack.Push(root); int visited=0,totalChars=0;
    while(stack.Count>0 && visited<150 && totalChars<12000) {
      var element=stack.Pop(); visited++;
      var data=element.Current;
      if(data.IsPassword) throw Block("password-control");
      string name=(data.Name??""); if(name.Length>200) name=name.Substring(0,200); totalChars+=name.Length;
      var rect=data.BoundingRectangle;
      if(!data.IsOffscreen && !String.IsNullOrWhiteSpace(name)) controls.Add(new Dictionary<string,object>{{"name",name},{"role",data.ControlType.ProgrammaticName},{"enabled",data.IsEnabled},{"bounds",new Dictionary<string,object>{{"x",rect.X},{"y",rect.Y},{"width",rect.Width},{"height",rect.Height}}}});
      var child=TreeWalker.ControlViewWalker.GetLastChild(element); int children=0;
      while(child!=null && children<150 && stack.Count<150) { stack.Push(child); child=TreeWalker.ControlViewWalker.GetPreviousSibling(child); children++; }
    }
    Check(handle,pid,true);
    return new Dictionary<string,object>{{"ok",true},{"window",Describe(hwnd,true)},{"controls",controls},{"truncated",stack.Count>0}};
  }
  static void PointCheck(IntPtr hwnd,uint pid,int x,int y) {
    RECT rect; if(!GetWindowRect(hwnd,out rect) || x<rect.Left || y<rect.Top || x>=rect.Right || y>=rect.Bottom) throw Block("point-outside-target");
    IntPtr point=WindowFromPoint(new POINT(x,y));
    if(point==IntPtr.Zero || GetAncestor(point,2)!=hwnd) throw Block("point-obscured");
    var element=AutomationElement.FromPoint(new System.Windows.Point(x,y));
    if(element==null || element.Current.ProcessId!=(int)pid || element.Current.IsPassword) throw Block("point-control-blocked");
  }
  public static void Click(string handle,uint pid,int x,int y) {
    IntPtr hwnd=Check(handle,pid,true); PointCheck(hwnd,pid,x,y); ModifiersReleased();
    if(!SetCursorPos(x,y)) throw Block("cursor-failed");
    Check(handle,pid,true); PointCheck(hwnd,pid,x,y);
    INPUT down=new INPUT(); down.type=0; down.U.mi.dwFlags=2;
    INPUT up=down; up.U.mi.dwFlags=4; Emit(new INPUT[]{down,up});
  }
  public static void TypeText(string handle,uint pid,string text) {
    if(String.IsNullOrEmpty(text) || text.Length>4000 || Regex.IsMatch(text,@"[\x00-\x1f\x7f]|(?:javascript|vbscript|data|file|shell|ms-settings|powershell):",RegexOptions.IgnoreCase)) throw Block("invalid-text");
    Check(handle,pid,true); ModifiersReleased();
    foreach(char value in text) {
      // Re-check every character so focus, desktop or password changes stop the remaining text.
      Check(handle,pid,true); ModifiersReleased();
      INPUT down=new INPUT(); down.type=1; down.U.ki.wScan=value; down.U.ki.dwFlags=4;
      INPUT up=down; up.U.ki.dwFlags=6; Emit(new INPUT[]{down,up});
    }
  }
  public static void Press(string handle,uint pid,string chord) {
    if(!SafeKeys.Contains(chord??"")) throw Block("key-blocked");
    Check(handle,pid,true); ModifiersReleased();
    var parts=chord.Split('+'); var items=new List<INPUT>();
    foreach(string part in parts) { INPUT down=new INPUT(); down.type=1; down.U.ki.wVk=Keys[part]; items.Add(down); }
    for(int index=parts.Length-1;index>=0;index--) { INPUT up=new INPUT(); up.type=1; up.U.ki.wVk=Keys[parts[index]]; up.U.ki.dwFlags=2; items.Add(up); }
    Check(handle,pid,true); Emit(items.ToArray());
  }
  public static void Scroll(string handle,uint pid,int deltaY) {
    if(deltaY==0 || Math.Abs((long)deltaY)>1200) throw Block("invalid-scroll");
    IntPtr hwnd=Check(handle,pid,true); ModifiersReleased();
    RECT rect; GetWindowRect(hwnd,out rect); int x=rect.Left+(rect.Right-rect.Left)/2,y=rect.Top+(rect.Bottom-rect.Top)/2;
    PointCheck(hwnd,pid,x,y); if(!SetCursorPos(x,y)) throw Block("cursor-failed");
    Check(handle,pid,true); PointCheck(hwnd,pid,x,y);
    INPUT wheel=new INPUT(); wheel.type=0; wheel.U.mi.dwFlags=0x0800; wheel.U.mi.mouseData=unchecked((uint)-deltaY); Emit(new INPUT[]{wheel});
  }
}
'@

try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Drawing
  $references = @([System.Drawing.Bitmap].Assembly.Location, [System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.TreeScope].Assembly.Location, [System.Windows.Point].Assembly.Location)
  Add-Type -TypeDefinition $source -ReferencedAssemblies $references -Language CSharp
  if ($CompileOnly) { @{ ok = $true; compiled = $true } | ConvertTo-Json -Compress; return }
  [BotDeskNative]::Init()
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line.Length -gt 32768) { throw 'invalid-request' }
  $request = $line | ConvertFrom-Json
  $action = [string]$request.action
  $inputArgs = $request.args
  if ($action -in @('foreground', 'list_windows')) {
    if ($action -eq 'foreground') { $result = @{ ok = $true; window = [BotDeskNative]::Foreground() } }
    else { $result = @{ ok = $true; windows = @([BotDeskNative]::Windows()) } }
  } else {
    if ($null -eq $inputArgs.expectedWindow -or [string]$inputArgs.expectedWindow.handle -notmatch '^[1-9][0-9]{0,18}$' -or $inputArgs.expectedWindow.processId -isnot [int] -or $inputArgs.expectedWindow.processId -le 0) { throw 'invalid-target' }
    $targetHandle = [string]$inputArgs.expectedWindow.handle
    $targetPid = [uint32]$inputArgs.expectedWindow.processId
    switch ($action) {
      'focus' { [BotDeskNative]::Focus($targetHandle,$targetPid); $result = @{ ok = $true } }
      'capture' { $result = [BotDeskNative]::Capture($targetHandle,$targetPid) }
      'snapshot' { $result = [BotDeskNative]::Snapshot($targetHandle,$targetPid) }
      'click' {
        if ($inputArgs.x -isnot [int] -or $inputArgs.y -isnot [int]) { throw 'invalid-point' }
        [BotDeskNative]::Click($targetHandle,$targetPid,$inputArgs.x,$inputArgs.y); $result = @{ ok = $true }
      }
      'type' { if ($inputArgs.text -isnot [string]) { throw 'invalid-text' }; [BotDeskNative]::TypeText($targetHandle,$targetPid,$inputArgs.text); $result = @{ ok = $true } }
      'key' { [BotDeskNative]::Press($targetHandle,$targetPid,([string]$inputArgs.key).ToUpperInvariant()); $result = @{ ok = $true } }
      'scroll' {
        if ($inputArgs.deltaY -isnot [int]) { throw 'invalid-scroll' }
        [BotDeskNative]::Scroll($targetHandle,$targetPid,$inputArgs.deltaY); $result = @{ ok = $true }
      }
      default { throw 'unknown-action' }
    }
  }
  $result | ConvertTo-Json -Compress -Depth 12
} catch {
  # Error details from UI Automation can include sensitive content. Keep the transport error generic.
  @{ ok = $false; error = 'native-action-blocked' } | ConvertTo-Json -Compress
}
