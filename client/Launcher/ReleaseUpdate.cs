using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace KarmaLocal {
  // Populated by JavaScriptSerializer from the signed release envelope.
#pragma warning disable 0649
  internal sealed class ReleaseFile { public string path; public long size; public string sha256; }
  internal sealed class ReleaseManifest { public int schema; public string version; public long sequence; public ReleaseFile[] files; }
  internal sealed class ReleaseEnvelope { public string payload; public string signature; }
  internal sealed class UpdateEntry { public string path; public bool existed; public string previousHash; }
  internal sealed class UpdateJournal { public UpdateEntry[] entries; }
#pragma warning restore 0649

  internal static class ReleaseUpdate {
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength=8*1024*1024, RecursionLimit=32 };
    internal static string Hash(byte[] data) { using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(data)).Replace("-","").ToLowerInvariant(); }
    internal static string HashFile(string file) { using(var sha=SHA256.Create())using(var stream=File.OpenRead(file))return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant(); }
    internal static string Identity(string root) { return Hash(Encoding.UTF8.GetBytes(Path.GetFullPath(root).TrimEnd('\\').ToUpperInvariant())).Substring(0,24); }
    internal static string StateDirectory(string root) { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"KarmaLAN","updates",Identity(root),ReleaseTrust.KeyEpoch); }
    internal static Mutex Acquire(string root) {
      var mutex=new Mutex(false,"Local\\KarmaRelease_"+Identity(root));
      bool acquired=false;try{acquired=mutex.WaitOne(0);}catch(AbandonedMutexException){acquired=true;}
      if(!acquired){mutex.Dispose();return null;}return mutex;
    }
    internal static bool Personal(string value) {
      string p=value.ToLowerInvariant(),name=Path.GetFileName(p);
      if(p.StartsWith(".karma-")||p.StartsWith("logs/")||p.StartsWith("userdata/"))return true;
      if(p.StartsWith("launcher/")&&(name.EndsWith("selection.json")||name.EndsWith("profile.json")||
        new[]{"playstyle.json","lan-start.json","lan-status.json","lan-cancel.json","loot-hint.json","lan-lobby-command.json","lan-lobby-result.json"}.Contains(name)||
        name.StartsWith("lan-config-")||name.StartsWith("pause-")||name.StartsWith("lan-start.")))return true;
      return p.EndsWith(".log")||p.EndsWith(".tmp")||p.EndsWith(".lnk");
    }
    internal static void CheckPath(string value) {
      if(String.IsNullOrEmpty(value)||value.Length>220||value.Contains('\\')||value.StartsWith("/")||Personal(value))throw new InvalidDataException("허용되지 않은 업데이트 경로입니다.");
      string[] parts=value.Split('/');
      if(parts.Length>16)throw new InvalidDataException("업데이트 경로가 너무 깁니다.");
      foreach(string part in parts)if(part.Length==0||part=="."||part==".."||part.EndsWith(".")||part.EndsWith(" ")||part.IndexOfAny(Path.GetInvalidFileNameChars())>=0||
        Regex.IsMatch(part,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)",RegexOptions.IgnoreCase))throw new InvalidDataException("허용되지 않은 업데이트 경로입니다.");
    }
    internal static string SafePath(string root,string relative) {
      CheckPath(relative);root=Path.GetFullPath(root).TrimEnd('\\');
      string full=Path.GetFullPath(Path.Combine(root,relative.Replace('/','\\')));
      if(!full.StartsWith(root+"\\",StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("설치 폴더 밖의 경로입니다.");
      for(string current=full;current!=null;current=Path.GetDirectoryName(current)) {
        if((File.Exists(current)||Directory.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException("연결된 폴더에는 업데이트할 수 없습니다.");
      }
      return full;
    }
    internal static ReleaseManifest Parse(byte[] envelope,string publicKey) {
      if(envelope.Length>8*1024*1024)throw new InvalidDataException("배포 정보가 너무 큽니다.");
      var signed=Json.Deserialize<ReleaseEnvelope>(Encoding.UTF8.GetString(envelope));
      byte[] payload=Convert.FromBase64String(signed.payload),signature=Convert.FromBase64String(signed.signature);
      using(var rsa=new RSACryptoServiceProvider()){rsa.PersistKeyInCsp=false;rsa.FromXmlString(publicKey);if(!rsa.VerifyData(payload,CryptoConfig.MapNameToOID("SHA256"),signature))throw new InvalidDataException("공식 배포 서명을 확인할 수 없습니다.");}
      var release=Json.Deserialize<ReleaseManifest>(Encoding.UTF8.GetString(payload));
      if(release.schema!=1||release.sequence<1||String.IsNullOrEmpty(release.version)||release.version.Length>40||release.files==null||release.files.Length<2||release.files.Length>20000)throw new InvalidDataException("올바르지 않은 배포 정보입니다.");
      var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long total=0;
      foreach(var file in release.files) {
        CheckPath(file.path);if(!names.Add(file.path)||file.size<0||file.size>1024L*1024*1024||file.sha256==null||!Regex.IsMatch(file.sha256,"^[a-f0-9]{64}$"))throw new InvalidDataException("올바르지 않은 배포 파일입니다.");
        total+=file.size;if(total>4L*1024*1024*1024)throw new InvalidDataException("배포 용량이 너무 큽니다.");
      }
      foreach(string name in names){string parent=name;while(parent.Contains('/')){parent=parent.Substring(0,parent.LastIndexOf('/'));if(names.Contains(parent))throw new InvalidDataException("파일과 폴더 경로가 충돌합니다.");}}
      if(!names.Contains("KarmaLauncher.exe")||!names.Contains("KarmaUpdater.exe"))throw new InvalidDataException("업데이트 실행 파일이 누락됐습니다.");
      return release;
    }
    internal static bool Matches(string root,ReleaseFile file) { string target=SafePath(root,file.path);return File.Exists(target)&&new FileInfo(target).Length==file.size&&HashFile(target)==file.sha256; }
    internal static List<ReleaseFile> Changes(string root,ReleaseManifest manifest,Action<string> progress) {
      var result=new List<ReleaseFile>();int i=0;
      foreach(var file in manifest.files){if(++i%80==0)progress("공식 파일 확인 중 · "+i+" / "+manifest.files.Length);if(!Matches(root,file))result.Add(file);}return result;
    }
    internal static List<string> ActiveProcesses(string root) {
      string prefix=Path.GetFullPath(root).TrimEnd('\\')+"\\";int self=Process.GetCurrentProcess().Id;var active=new List<string>();
      foreach(var process in Process.GetProcesses())using(process) {
        if(process.Id==self)continue;
        try{string executable=process.MainModule.FileName;if(executable.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))active.Add(process.ProcessName);}catch(System.ComponentModel.Win32Exception){}catch(InvalidOperationException){}
      }
      return active;
    }
    internal static void RequireIdle(string root) {var active=ActiveProcesses(root);if(active.Count>0)throw new IOException("게임 또는 다른 카르마 창이 실행 중입니다. 종료한 뒤 다시 시도해 주세요.\n"+String.Join(", ",active.Distinct()));}
    internal static HttpWebRequest Request(string suffix) {
      var request=(HttpWebRequest)WebRequest.Create(ReleaseTrust.Origin+"/client-release/"+suffix);
      request.AllowAutoRedirect=false;request.Timeout=20000;request.ReadWriteTimeout=30000;request.Proxy=null;
      request.ServerCertificateValidationCallback=(sender,cert,chain,errors)=>cert!=null&&Hash(cert.GetRawCertData())==ReleaseTrust.CertificateSha256&&DateTime.UtcNow>=DateTime.Parse(cert.GetEffectiveDateString()).ToUniversalTime()&&DateTime.UtcNow<=DateTime.Parse(cert.GetExpirationDateString()).ToUniversalTime();
      return request;
    }
    internal static byte[] FetchManifest() {
      ServicePointManager.SecurityProtocol|=SecurityProtocolType.Tls12;
      using(var response=(HttpWebResponse)Request("manifest.json").GetResponse())using(var input=response.GetResponseStream())using(var output=new MemoryStream()) {
        if(response.StatusCode!=HttpStatusCode.OK)throw new IOException("공식 배포 서버 응답을 확인할 수 없습니다.");
        byte[] buffer=new byte[65536];int count;while((count=input.Read(buffer,0,buffer.Length))>0){if(output.Length+count>8*1024*1024)throw new InvalidDataException("배포 정보가 너무 큽니다.");output.Write(buffer,0,count);}return output.ToArray();
      }
    }
    internal static void DurableWrite(string file,byte[] data) {Directory.CreateDirectory(Path.GetDirectoryName(file));using(var output=new FileStream(file,FileMode.Create,FileAccess.Write,FileShare.None)){output.Write(data,0,data.Length);output.Flush(true);}}
    internal static void DurableCopy(string source,string target) {Directory.CreateDirectory(Path.GetDirectoryName(target));using(var input=File.OpenRead(source))using(var output=new FileStream(target,FileMode.Create,FileAccess.Write,FileShare.None)){input.CopyTo(output);output.Flush(true);}}
    internal static void AtomicCopy(string source,string target) {
      string temp=target+".karma-new-"+Guid.NewGuid().ToString("N");
      try{DurableCopy(source,temp);if(File.Exists(target))File.Replace(temp,target,null);else File.Move(temp,target);}finally{if(File.Exists(temp))File.Delete(temp);}
    }
    internal static void AtomicWrite(string target,byte[] data) {
      string temp=target+".new-"+Guid.NewGuid().ToString("N");
      try{DurableWrite(temp,data);if(File.Exists(target))File.Replace(temp,target,null);else File.Move(temp,target);}finally{if(File.Exists(temp))File.Delete(temp);}
    }
    internal static void Download(ReleaseFile file,string target,Action<string> progress) {
      Directory.CreateDirectory(Path.GetDirectoryName(target));
      using(var response=(HttpWebResponse)Request("files/"+file.sha256).GetResponse())using(var input=response.GetResponseStream())using(var output=new FileStream(target,FileMode.Create,FileAccess.Write,FileShare.None)) {
        if(response.StatusCode!=HttpStatusCode.OK||response.ContentLength!=file.size)throw new InvalidDataException("배포 파일 크기가 일치하지 않습니다.");
        byte[] buffer=new byte[131072];long received=0;int count;
        while((count=input.Read(buffer,0,buffer.Length))>0){received+=count;if(received>file.size)throw new InvalidDataException("배포 파일이 너무 큽니다.");output.Write(buffer,0,count);progress("업데이트 받는 중 · "+Path.GetFileName(file.path)+" · "+(received/1048576)+" MB");}
        output.Flush(true);
      }
      if(new FileInfo(target).Length!=file.size||HashFile(target)!=file.sha256)throw new InvalidDataException("배포 파일 검증에 실패했습니다. 다시 시도해 주세요.");
    }
    internal static string Prepare(string root,byte[] envelope,ReleaseManifest release,List<ReleaseFile> changes,Action<string> progress) {
      string stage=Path.Combine(StateDirectory(root),"job-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(stage);
      DurableWrite(Path.Combine(stage,"manifest.json"),envelope);
      var files=new List<ReleaseFile>(changes);var helper=release.files.Single(f=>f.path=="KarmaUpdater.exe");
      if(!files.Contains(helper))files.Add(helper);
      foreach(var file in files){string destination=SafePath(Path.Combine(stage,"files"),file.path);if(Matches(root,file))DurableCopy(SafePath(root,file.path),destination);else Download(file,destination,progress);}
      return stage;
    }
    internal static void CheckSequence(string root,ReleaseManifest release) {
      string file=Path.Combine(StateDirectory(root),"sequence");long highest;
      if(File.Exists(file)&&(!Int64.TryParse(File.ReadAllText(file),out highest)||release.sequence<highest))throw new InvalidDataException("이전에 확인한 버전보다 오래된 배포입니다. 관리자에게 문의해 주세요.");
    }
    internal static void RecordSequence(string root,ReleaseManifest release) {CheckSequence(root,release);AtomicWrite(Path.Combine(StateDirectory(root),"sequence"),Encoding.ASCII.GetBytes(release.sequence.ToString()));}
    internal static string Pending(string root) {return Path.Combine(StateDirectory(root),"pending");}
    internal static void Recover(string root,string publicKey) {
      if(!File.Exists(Pending(root)))return;
      RequireIdle(root);
      string stage=File.ReadAllText(Pending(root)),prefix=StateDirectory(root)+Path.DirectorySeparatorChar;
      if(!Path.GetFullPath(stage).StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("업데이트 복구 경로가 올바르지 않습니다.");
      var manifest=Parse(File.ReadAllBytes(Path.Combine(stage,"manifest.json")),publicKey);
      var journal=Json.Deserialize<UpdateJournal>(File.ReadAllText(Path.Combine(stage,"journal.json")));
      var names=new HashSet<string>(manifest.files.Select(f=>f.path),StringComparer.OrdinalIgnoreCase);
      foreach(var entry in journal.entries) {
        if(!names.Remove(entry.path))throw new InvalidDataException("업데이트 복구 정보가 올바르지 않습니다.");
        string target=SafePath(root,entry.path);
        if(entry.existed) {string backup=SafePath(Path.Combine(stage,"backup"),entry.path);if(HashFile(backup)!=entry.previousHash)throw new InvalidDataException("업데이트 백업이 손상되었습니다.");AtomicCopy(backup,target);}
        else if(File.Exists(target))File.Delete(target);
      }
      File.Delete(Pending(root));
    }
    internal static void Apply(string root,string stage,string publicKey,Action<string> progress,Action<int> afterReplace=null) {
      RequireIdle(root);Recover(root,publicKey);
      var manifest=Parse(File.ReadAllBytes(Path.Combine(stage,"manifest.json")),publicKey);CheckSequence(root,manifest);
      var changes=Changes(root,manifest,progress).OrderBy(f=>f.path=="KarmaLauncher.exe"?1:0).ToList();
      foreach(var file in changes)if(!Matches(Path.Combine(stage,"files"),file))throw new InvalidDataException("다운로드한 업데이트 파일이 손상되었습니다.");
      var journal=new UpdateJournal { entries=changes.Select(file=>{string target=SafePath(root,file.path);bool exists=File.Exists(target);return new UpdateEntry{path=file.path,existed=exists,previousHash=exists?HashFile(target):null};}).ToArray() };
      foreach(var entry in journal.entries)if(entry.existed)DurableCopy(SafePath(root,entry.path),SafePath(Path.Combine(stage,"backup"),entry.path));
      DurableWrite(Path.Combine(stage,"journal.json"),Encoding.UTF8.GetBytes(Json.Serialize(journal)));
      AtomicWrite(Pending(root),Encoding.UTF8.GetBytes(stage));
      try {
        int count=0;foreach(var file in changes){RequireIdle(root);progress("업데이트 적용 중 · "+file.path);AtomicCopy(SafePath(Path.Combine(stage,"files"),file.path),SafePath(root,file.path));if(afterReplace!=null)afterReplace(++count);}
        if(Changes(root,manifest,progress).Count!=0)throw new IOException("업데이트 후 파일 검증에 실패했습니다.");
        RecordSequence(root,manifest);File.Delete(Pending(root));
      } catch {Recover(root,publicKey);throw;}
    }
  }
}
