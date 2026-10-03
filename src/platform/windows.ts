import { join } from 'node:path';

/** CRT argument quoting; shell interpretation is disabled for ordinary executables. */
export function quoteWindowsArgument(value: string): string {
  if (/[\0\r\n]/u.test(value)) throw new Error('Windows process arguments cannot contain NUL or line breaks');
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`;
}

export function windowsBatchCommand(executable: string, args: string[]): { executable: string; args: string[] } {
  // cmd.exe expands these even inside quotes. A batch file may expand %* a second
  // time, so reject shell operators too rather than promise unsafe quoting.
  for (const value of [executable, ...args]) {
    if (/["%!^&|<>\r\n\0]/u.test(value)) throw new Error('Unsafe character in Windows batch path or argument');
  }
  // Wrapper scripts forward %* to a native JVM. Preserve trailing backslashes
  // through that second command-line parse as well as whitespace and empty args.
  const command = `"${[executable, ...args].map(quoteWindowsArgument).join(' ')}"`;
  return { executable: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'), args: ['/d', '/v:off', '/s', '/c', command] };
}

// The guardian owns a Windows Job Object with KILL_ON_JOB_CLOSE. Creating the
// application suspended avoids a race where it could spawn children before
// joining the job. When the application exits (or the guardian is terminated),
// closing the job also disposes its descendants. No persisted PID is trusted.
const guardian = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HarnessJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long a,b; public uint flags; public UIntPtr min,max; public uint count; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public Basic basic; public Io io; public UIntPtr process,job,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public uint size; public string reserved,desktop,title; public uint x,y,width,height,cx,cy,fill,flags; public ushort show,reservedSize; public IntPtr reservedPtr,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref Limits limits,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,System.Text.StringBuilder command,IntPtr ps,IntPtr ts,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out ProcessInfo pi);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr h,uint mask,uint flags);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint timeout);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  static Exception Error(string operation) { return new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),operation); }
  public static int Run(string command,string cwd) {
    IntPtr job=CreateJobObject(IntPtr.Zero,null);
    if(job==IntPtr.Zero) throw Error("CreateJobObject");
    ProcessInfo pi=new ProcessInfo();
    try {
      Limits limits=new Limits(); limits.basic.flags=0x2000;
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits)))) throw Error("SetInformationJobObject");
      Startup startup=new Startup(); startup.size=(uint)Marshal.SizeOf(typeof(Startup)); startup.flags=0x100;
      startup.input=GetStdHandle(-10); startup.output=GetStdHandle(-11); startup.error=GetStdHandle(-12);
      foreach(IntPtr handle in new IntPtr[]{startup.input,startup.output,startup.error}) if(!SetHandleInformation(handle,1,1)) throw Error("SetHandleInformation");
      if(!CreateProcess(null,new System.Text.StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref startup,out pi)) throw Error("CreateProcess");
      if(!AssignProcessToJobObject(job,pi.process)) { TerminateProcess(pi.process,1); throw Error("AssignProcessToJobObject"); }
      if(ResumeThread(pi.thread)==0xffffffff) { TerminateProcess(pi.process,1); throw Error("ResumeThread"); }
      WaitForSingleObject(pi.process,0xffffffff);
      uint code; if(!GetExitCodeProcess(pi.process,out code)) throw Error("GetExitCodeProcess");
      return unchecked((int)code);
    } finally { if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread); if(pi.process!=IntPtr.Zero) CloseHandle(pi.process); CloseHandle(job); }
  }
}
'@
  $launch = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PAYLOAD__')) | ConvertFrom-Json
  exit [HarnessJob]::Run($launch.command, $launch.cwd)
} catch { [Console]::Error.WriteLine('Harness process infrastructure error: ' + $_.Exception.Message); exit 125 }
`;

export function windowsOwnedCommand(executable: string, args: string[], cwd: string): { executable: string; args: string[] } {
  const batch = /\.(?:bat|cmd)$/iu.test(executable);
  const launch = batch ? windowsBatchCommand(executable, args) : { executable, args };
  const command = batch
    ? `${quoteWindowsArgument(launch.executable)} /d /v:off /s /c ${launch.args[4]}`
    : [launch.executable, ...launch.args].map(quoteWindowsArgument).join(' ');
  const payload = Buffer.from(JSON.stringify({ command, cwd }), 'utf8').toString('base64');
  const script = guardian.replace('__PAYLOAD__', payload);
  return { executable: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
}
