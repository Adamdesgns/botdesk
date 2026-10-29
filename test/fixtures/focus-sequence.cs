using System;
using System.Collections.Generic;

// Inert substitutes for the dependencies of the production Focus method.
// No P/Invoke, UI Automation, windows, input, real clock, or real sleeping.
public static class FocusSequenceFixture {
  static readonly IntPtr Target = new IntPtr(1001);
  static IntPtr foreground;
  static int now, activateAt, staleAt, nativeCalls, providerCalls, finalChecks;
  static bool nativeResult, nativeActivates, providerActivates, providerThrows;
  static bool protectedFinal, loseAtFinal;
  static Exception Block(string reason) { return new Exception(reason); }
  static IntPtr GetForegroundWindow() {
    if(activateAt >= 0 && now >= activateAt) foreground = Target;
    return foreground;
  }
  static bool SetForegroundWindow(IntPtr hwnd) {
    if(hwnd != Target) throw new Exception("wrong-native-target");
    nativeCalls++;
    if(nativeActivates) foreground = Target;
    return nativeResult;
  }
  static void BasicCheck(IntPtr hwnd,uint pid,bool requireForeground) {
    if(hwnd != Target || pid != 123 || (staleAt >= 0 && now >= staleAt)) throw Block("target-changed");
    if(requireForeground && GetForegroundWindow() != hwnd) throw Block("target-not-foreground");
  }
  static IntPtr Check(string handle,uint pid,bool requireForeground,bool hostedFocus=false) {
    var hwnd = new IntPtr(Int64.Parse(handle));
    if(requireForeground) {
      finalChecks++;
      if(loseAtFinal) { activateAt = -1; foreground = new IntPtr(2002); }
    }
    BasicCheck(hwnd,pid,requireForeground);
    if(requireForeground && protectedFinal) throw Block("credential");
    return hwnd;
  }
  sealed class AutomationElement {
    public static AutomationElement FromHandle(IntPtr hwnd) {
      if(hwnd != Target) throw new Exception("wrong-provider-target");
      return new AutomationElement();
    }
    public void SetFocus() {
      providerCalls++;
      if(providerActivates) foreground = Target;
      if(providerThrows) throw new Exception("private-provider-details");
    }
  }
  sealed class Stopwatch {
    int start;
    public static Stopwatch StartNew() { return new Stopwatch { start = now }; }
    public long ElapsedMilliseconds { get { return now - start; } }
  }
  static class Thread {
    public static void Sleep(int milliseconds) { now += milliseconds; }
  }

  /* PRODUCTION_FOCUS */

  public static Dictionary<string,object> Run(string scenario) {
    foreground = new IntPtr(2002); now = 0; activateAt = staleAt = -1;
    nativeCalls = providerCalls = finalChecks = 0;
    nativeResult = nativeActivates = providerActivates = providerThrows = protectedFinal = loseAtFinal = false;
    switch(scenario) {
      case "already-foreground": foreground = Target; break;
      case "native-immediate": nativeResult = nativeActivates = true; break;
      case "native-delayed": nativeResult = true; activateAt = 75; break;
      case "provider-success": providerActivates = true; break;
      case "provider-throws-after-activation": providerActivates = providerThrows = true; break;
      case "provider-throws-before-delayed-activation": providerThrows = true; activateAt = 75; break;
      case "transient-null": foreground = IntPtr.Zero; nativeResult = true; activateAt = 50; break;
      case "native-refusal": break;
      case "provider-throws-without-activation": providerThrows = true; break;
      case "native-true-without-activation": nativeResult = true; break;
      case "different-window": nativeResult = true; foreground = new IntPtr(1002); break;
      case "stale-before-attempt": staleAt = 0; break;
      case "stale-during-observation": nativeResult = true; staleAt = 50; activateAt = 75; break;
      case "protected-after-provider-exception": providerActivates = providerThrows = protectedFinal = true; break;
      case "foreground-lost-at-final-check": nativeActivates = nativeResult = loseAtFinal = true; break;
      default: throw new Exception("unknown-fixture");
    }
    string error = null;
    try { Focus("1001",123); } catch(Exception exception) { error = exception.Message; }
    return new Dictionary<string,object> {
      {"scenario",scenario}, {"error",error}, {"elapsed",now},
      {"nativeCalls",nativeCalls}, {"providerCalls",providerCalls}, {"finalChecks",finalChecks}
    };
  }
}
