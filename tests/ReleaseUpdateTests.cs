using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using KarmaLocal;

class ReleaseUpdateTests {
  static void Check(bool test,string message){if(!test)throw new Exception(message);}
  static void Reject(Action call,string message){bool rejected=false;try{call();}catch{rejected=true;}Check(rejected,message);}
  static byte[] Sign(ReleaseManifest manifest,RSACryptoServiceProvider key){byte[] data=Encoding.UTF8.GetBytes(ReleaseUpdate.Json.Serialize(manifest));return Encoding.UTF8.GetBytes(ReleaseUpdate.Json.Serialize(new ReleaseEnvelope{payload=Convert.ToBase64String(data),signature=Convert.ToBase64String(key.SignData(data,CryptoConfig.MapNameToOID("SHA256")))}));}
  static int Main(string[] args){
    if(args.Length>0&&args[0]=="--sleep"){System.Threading.Thread.Sleep(30000);return 0;}
    if(args.Length==4&&args[0]=="--crash"){ReleaseUpdate.Apply(args[1],args[2],File.ReadAllText(args[3]),s=>{},i=>{if(i==2)Environment.Exit(77);});return 1;}
    string root=Path.Combine(Path.GetTempPath(),"Karma update test "+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
    using(var key=new RSACryptoServiceProvider(2048)){
      key.PersistKeyInCsp=false;string pub=key.ToXmlString(false),stage=Path.Combine(ReleaseUpdate.StateDirectory(root),"job-fixture");
      string[] paths={"KarmaLauncher.exe","KarmaUpdater.exe","Launcher/input.js","Launcher/new.js"};
      var release=new ReleaseManifest{schema=1,version="test",sequence=10,files=paths.Select(p=>new ReleaseFile{path=p,size=Encoding.UTF8.GetByteCount("new "+p),sha256=ReleaseUpdate.Hash(Encoding.UTF8.GetBytes("new "+p))}).ToArray()};
      byte[] envelope=Sign(release,key);ReleaseUpdate.DurableWrite(Path.Combine(stage,"manifest.json"),envelope);
      foreach(var file in release.files)ReleaseUpdate.DurableWrite(ReleaseUpdate.SafePath(Path.Combine(stage,"files"),file.path),Encoding.UTF8.GetBytes("new "+file.path));
      foreach(string file in paths.Take(3))ReleaseUpdate.DurableWrite(ReleaseUpdate.SafePath(root,file),Encoding.UTF8.GetBytes("old "+file));
      string personal=Path.Combine(root,"Launcher","selection.json");File.WriteAllText(personal,"personal settings");
      Check(ReleaseUpdate.Parse(envelope,pub).files.Length==4,"valid signature");
      var tampered=ReleaseUpdate.Json.Deserialize<ReleaseEnvelope>(Encoding.UTF8.GetString(envelope));tampered.payload=Convert.ToBase64String(Encoding.UTF8.GetBytes("tampered"));
      Reject(()=>ReleaseUpdate.Parse(Encoding.UTF8.GetBytes(ReleaseUpdate.Json.Serialize(tampered)),pub),"tampered signature accepted");
      foreach(string path in new[]{"../outside","/outside","C:/outside","Launcher/selection.json","Launcher/COn.txt","a./b","a\\b"})Reject(()=>ReleaseUpdate.CheckPath(path),"path accepted "+path);
      Check(ReleaseUpdate.Changes(root,release,s=>{}).Count==4,"changed/missing detection");
      string payload=Path.Combine(stage,"files","Launcher","input.js");File.AppendAllText(payload,"bad");
      Reject(()=>ReleaseUpdate.Apply(root,stage,pub,s=>{}),"corrupt payload accepted");Check(File.ReadAllText(Path.Combine(root,"KarmaLauncher.exe")).StartsWith("old"),"changed on hash failure");
      File.WriteAllText(payload,"new Launcher/input.js",new UTF8Encoding(false));
      Reject(()=>ReleaseUpdate.Apply(root,stage,pub,s=>{},i=>{if(i==2)throw new IOException("injected failure");}),"injected failure ignored");
      foreach(string file in paths.Take(3))Check(File.ReadAllText(Path.Combine(root,file))=="old "+file,"rollback failed "+file);
      Check(!File.Exists(Path.Combine(root,"Launcher","new.js")),"new file rollback");Check(File.ReadAllText(personal)=="personal settings","settings changed");
      string pubfile=Path.Combine(stage,"test-public.xml");File.WriteAllText(pubfile,pub);
      using(var crash=Process.Start(new ProcessStartInfo{FileName=Process.GetCurrentProcess().MainModule.FileName,Arguments="--crash \""+root+"\" \""+stage+"\" \""+pubfile+"\"",UseShellExecute=false,CreateNoWindow=true})){
        crash.WaitForExit();Check(crash.ExitCode==77,"crash fixture did not interrupt apply");
      }
      Check(File.Exists(ReleaseUpdate.Pending(root)),"crash journal missing");ReleaseUpdate.Recover(root,pub);
      foreach(string file in paths.Take(3))Check(File.ReadAllText(Path.Combine(root,file))=="old "+file,"crash recovery failed "+file);
      ReleaseUpdate.Apply(root,stage,pub,s=>{});Check(ReleaseUpdate.Changes(root,release,s=>{}).Count==0,"apply failed");Check(File.ReadAllText(personal)=="personal settings","settings changed");
      release.sequence=9;Reject(()=>ReleaseUpdate.CheckSequence(root,release),"downgrade accepted");release.sequence=10;
      File.WriteAllText(Path.Combine(root,"Launcher","input.js"),"same-version corruption");Check(ReleaseUpdate.Changes(root,release,s=>{}).Count==1,"same-version damage missed");ReleaseUpdate.Apply(root,stage,pub,s=>{});
      // A real child process in the install directory blocks replacement.
      string sleeper=Path.Combine(root,"sleep-test.exe");File.Copy(Process.GetCurrentProcess().MainModule.FileName,sleeper);
      using(var child=Process.Start(new ProcessStartInfo{FileName=sleeper,Arguments="--sleep",UseShellExecute=false,CreateNoWindow=true})){
        try{Check(ReleaseUpdate.ActiveProcesses(root).Count>0,"running game detection");Reject(()=>ReleaseUpdate.Apply(root,stage,pub,s=>{}),"updated active installation");}finally{if(!child.HasExited)child.Kill();child.WaitForExit();}
      }
      Console.WriteLine("PASS signed update: tamper/path rejection, missing/changed hashes, damaged download, rollback and process-crash recovery, settings, same-version repair, downgrade prevention, active process guard");
    }
    // Delete only this exact temporary fixture and its derived update cache.
    string state=ReleaseUpdate.StateDirectory(root);Check(Path.GetFullPath(root).StartsWith(Path.GetTempPath(),StringComparison.OrdinalIgnoreCase),"cleanup outside fixture");Directory.Delete(root,true);Directory.Delete(state,true);return 0;
  }
}
