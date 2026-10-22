using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace KarmaLocal {
  internal sealed class UpdateWindow : Form {
    readonly Label status=new Label();readonly Button retry=new Button();readonly string root;readonly string stage;readonly int parentPid;
    bool busy;internal bool Ready;
    internal UpdateWindow(string root,string stage=null,int parentPid=0) {
      this.root=root;this.stage=stage;this.parentPid=parentPid;
      Text="카르마 · 공식 버전 확인";ClientSize=new Size(540,190);StartPosition=FormStartPosition.CenterScreen;FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;
      Font=new Font("맑은 고딕",10);status.SetBounds(24,25,490,90);status.Text="공식 배포 파일을 확인하고 있습니다…";Controls.Add(status);
      retry.Text="다시 시도";retry.SetBounds(290,136,100,32);retry.Visible=false;retry.Click+=async(s,e)=>await Run();Controls.Add(retry);
      var close=new Button{Text="닫기"};close.SetBounds(405,136,100,32);close.Click+=(s,e)=>{if(!busy)Close();};Controls.Add(close);
      FormClosing+=(s,e)=>{if(busy)e.Cancel=true;};Shown+=async(s,e)=>await Run();
    }
    void Progress(string text){if(IsDisposed)return;BeginInvoke(new Action(()=>{if(!IsDisposed)status.Text=text;}));}
    async Task Run(){
      if(busy)return;busy=true;retry.Visible=false;
      try{
        if(stage==null){
          string prepared=await Task.Run(()=>{
            ReleaseUpdate.Recover(root,ReleaseTrust.PublicKey);
            var envelope=ReleaseUpdate.FetchManifest();var manifest=ReleaseUpdate.Parse(envelope,ReleaseTrust.PublicKey);ReleaseUpdate.CheckSequence(root,manifest);
            var changes=ReleaseUpdate.Changes(root,manifest,Progress);
            if(changes.Count==0){ReleaseUpdate.RecordSequence(root,manifest);return null;}
            ReleaseUpdate.RequireIdle(root);Progress("공식 버전 "+manifest.version+" · "+changes.Count+"개 파일을 갱신합니다.");
            return ReleaseUpdate.Prepare(root,envelope,manifest,changes,Progress);
          });
          if(prepared==null)Ready=true;
          else {
            var manifest=ReleaseUpdate.Parse(File.ReadAllBytes(Path.Combine(prepared,"manifest.json")),ReleaseTrust.PublicKey);
            string helper=Path.Combine(prepared,"KarmaUpdater.exe");ReleaseUpdate.DurableCopy(Path.Combine(prepared,"files","KarmaUpdater.exe"),helper);
            if(ReleaseUpdate.HashFile(helper)!=manifest.files.Single(f=>f.path=="KarmaUpdater.exe").sha256)throw new InvalidDataException("업데이트 프로그램 검증에 실패했습니다.");
            Process.Start(new ProcessStartInfo{FileName=helper,Arguments="--apply \""+root.TrimEnd('\\')+"\" \""+prepared+"\" "+Process.GetCurrentProcess().Id,UseShellExecute=false,WorkingDirectory=prepared});
          }
        }else{
          await Task.Run(()=>{
            try{using(var parent=Process.GetProcessById(parentPid)){if(!parent.WaitForExit(30000))throw new IOException("기존 카르마 창이 종료되지 않았습니다.");}}catch(ArgumentException){}
            using(var lease=ReleaseUpdate.Acquire(root)){if(lease==null)throw new IOException("다른 카르마 창을 닫고 다시 시도해 주세요.");try{ReleaseUpdate.Apply(root,stage,ReleaseTrust.PublicKey,Progress);}finally{lease.ReleaseMutex();}}
          });
          Process.Start(new ProcessStartInfo{FileName=Path.Combine(root,"KarmaLauncher.exe"),WorkingDirectory=root,UseShellExecute=false});
        }
        busy=false;Close();
      }catch(Exception ex){busy=false;status.Text="업데이트를 완료하지 못했습니다.\nLAN 연결과 게임 종료 여부를 확인한 뒤 다시 시도해 주세요.\n"+ex.Message;retry.Visible=true;}
    }
  }
}
