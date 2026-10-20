using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace KarmaLocal {
  public sealed class AuthDialog : Form {
    public bool Authenticated { get; private set; }
    public bool SignedOut { get; private set; }
    readonly string support,nodePath,host;
    readonly int port;
    readonly JavaScriptSerializer json=new JavaScriptSerializer();
    readonly Color ink=Color.FromArgb(235,238,235),muted=Color.FromArgb(162,175,181),
      accent=Color.FromArgb(222,181,100),warning=Color.FromArgb(255,175,153);
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer{Interval=1000};
    TabControl tabs;
    TextBox loginEmail,loginPassword,signupEmail,signupPassword,signupName,verificationCode;
    Label status,verificationHelp;
    Button action,resend,edit;
    Panel verificationPanel;
    bool busy,pending,accountMode;
    volatile bool closing;
    DateTime resendAt,expiresAt;

    public AuthDialog(string root,string support,string nodePath,string host,int port) {
      this.support=support;this.nodePath=nodePath;this.host=host;this.port=port;
      Text="카르마 · 로그인";
      Font=new Font("Malgun Gothic",10F);AutoScaleDimensions=new SizeF(96F,96F);AutoScaleMode=AutoScaleMode.Dpi;
      ClientSize=new Size(560,590);MinimumSize=Size.Empty;StartPosition=FormStartPosition.CenterParent;
      BackColor=Color.FromArgb(16,22,27);ForeColor=ink;ShowInTaskbar=false;MinimizeBox=false;MaximizeBox=false;
      Build();
      timer.Tick+=(s,e)=>UpdateUi();timer.Start();
      FormClosing+=(s,e)=>{closing=true;};
      FormClosed+=(s,e)=>{timer.Stop();ClearPasswords();};
      Shown+=(s,e)=>{
        Rectangle area=Screen.FromControl(Owner??this).WorkingArea;
        Size=new Size(Math.Min(Width,Math.Max(1,area.Width-24)),Math.Min(Height,Math.Max(1,area.Height-24)));
        Location=new Point(area.Left+(area.Width-Width)/2,area.Top+(area.Height-Height)/2);
        if(!accountMode)loginEmail.Focus();
      };
    }
    Label TextLabel(string text,bool heading=false) {
      return new Label{Text=text,AutoSize=true,Dock=DockStyle.Fill,Margin=new Padding(0,4,0,8),
        ForeColor=heading?ink:muted,Font=new Font("Malgun Gothic",heading?14F:9F,heading?FontStyle.Bold:FontStyle.Regular)};
    }
    Button MakeButton(string text) {
      var b=new Button{Text=text,AutoSize=true,MinimumSize=new Size(110,38),
        Padding=new Padding(10,3,10,3),Margin=new Padding(8,0,0,0),FlatStyle=FlatStyle.Flat,
        BackColor=Color.FromArgb(34,44,51),ForeColor=ink};
      b.FlatAppearance.BorderColor=Color.FromArgb(60,74,83);return b;
    }
    TableLayoutPanel FormGrid(Control owner) {
      var grid=new TableLayoutPanel{Dock=DockStyle.Top,AutoSize=true,ColumnCount=1,
        Padding=new Padding(18),Margin=Padding.Empty,BackColor=BackColor,ForeColor=ink};
      grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));owner.Controls.Add(grid);return grid;
    }
    TextBox Field(TableLayoutPanel grid,string caption,bool password,int maxLength) {
      grid.Controls.Add(TextLabel(caption));
      var box=new TextBox{Dock=DockStyle.Top,MaxLength=maxLength,UseSystemPasswordChar=password,
        Margin=new Padding(0,0,0,14)};
      grid.Controls.Add(box);return box;
    }
    void Build() {
      var frame=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=3,Padding=Padding.Empty};
      frame.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      frame.RowStyles.Add(new RowStyle(SizeType.AutoSize));
      frame.RowStyles.Add(new RowStyle(SizeType.Percent,100));
      frame.RowStyles.Add(new RowStyle(SizeType.AutoSize));Controls.Add(frame);
      var header=new TableLayoutPanel{Dock=DockStyle.Fill,AutoSize=true,ColumnCount=1,
        Padding=new Padding(18),Margin=Padding.Empty,BackColor=BackColor,ForeColor=ink};
      header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));frame.Controls.Add(header,0,0);
      header.Controls.Add(TextLabel("중앙 서버 계정",true));
      header.Controls.Add(TextLabel("서버 "+host+":"+port+" · 계급과 대전 기록이 계정에 저장됩니다."));
      tabs=new TabControl{Dock=DockStyle.Fill,Margin=new Padding(12,0,12,0)};
      var loginPage=new TabPage("로그인"){AutoScroll=true,BackColor=BackColor};
      var signupPage=new TabPage("계정 만들기"){AutoScroll=true,BackColor=BackColor};
      tabs.TabPages.Add(loginPage);tabs.TabPages.Add(signupPage);frame.Controls.Add(tabs,0,1);
      var login=FormGrid(loginPage);
      loginEmail=Field(login,"이메일",false,254);loginPassword=Field(login,"비밀번호",true,128);
      login.Controls.Add(TextLabel("기존 계정으로 로그인하면 서버에 저장된 계급을 불러옵니다."));
      var signup=FormGrid(signupPage);
      signupName=Field(signup,"게임에서 사용할 이름 (1~32자)",false,32);
      signupEmail=Field(signup,"이메일",false,254);
      signupPassword=Field(signup,"비밀번호 (8~128자)",true,128);
      signup.Controls.Add(TextLabel("이메일은 로그인에 사용됩니다."));
      verificationPanel=new Panel{Dock=DockStyle.Top,AutoSize=true,Visible=false,Margin=Padding.Empty};
      var verification=FormGrid(verificationPanel);verification.Padding=Padding.Empty;
      verificationCode=Field(verification,"이메일 인증번호 (숫자 6자리)",false,6);
      verificationHelp=TextLabel("");verification.Controls.Add(verificationHelp);
      var codeButtons=new FlowLayoutPanel{Dock=DockStyle.Top,AutoSize=true,WrapContents=true};
      resend=MakeButton("인증번호 다시 보내기");edit=MakeButton("가입 정보 수정");
      codeButtons.Controls.Add(resend);codeButtons.Controls.Add(edit);verification.Controls.Add(codeButtons);
      signup.Controls.Add(verificationPanel);
      resend.Click+=async(s,e)=>await RequestRegistration();
      edit.Click+=(s,e)=>{pending=false;verificationCode.Clear();SetRegistrationReadOnly(false);
        status.Text="가입 정보를 수정한 뒤 다시 가입하기를 누르세요.";UpdateUi();};
      tabs.SelectedIndexChanged+=(s,e)=>{if(!busy){status.Text="";UpdateUi();}};
      verificationCode.TextChanged+=(s,e)=>UpdateUi();
      var footer=new TableLayoutPanel{Dock=DockStyle.Fill,AutoSize=true,ColumnCount=1,Padding=new Padding(18)};
      footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      status=TextLabel("");footer.Controls.Add(status);
      var buttons=new FlowLayoutPanel{Dock=DockStyle.Top,AutoSize=true,FlowDirection=FlowDirection.RightToLeft};
      action=MakeButton("로그인");action.BackColor=accent;action.ForeColor=Color.FromArgb(25,28,26);
      var cancel=MakeButton("취소");cancel.DialogResult=DialogResult.Cancel;
      buttons.Controls.Add(action);buttons.Controls.Add(cancel);footer.Controls.Add(buttons);frame.Controls.Add(footer,0,2);
      AcceptButton=action;CancelButton=cancel;
      action.Click+=async(s,e)=>{
        if(busy)return;
        if(tabs.SelectedIndex==0)await Login();
        else if(pending)await Verify();
        else await RequestRegistration();
      };
      UpdateUi();
    }
    static string Value(Dictionary<string,object> d,string key,string fallback="") {
      object v;return d!=null&&d.TryGetValue(key,out v)&&v!=null?Convert.ToString(v):fallback;
    }
    static Dictionary<string,object> Dict(Dictionary<string,object> d,string key) {
      object v;return d!=null&&d.TryGetValue(key,out v)?v as Dictionary<string,object>:null;
    }
    static int Number(Dictionary<string,object> d,string key,int fallback) {
      int n;return Int32.TryParse(Value(d,key),out n)?n:fallback;
    }
    static bool Flag(Dictionary<string,object> d,string key,bool fallback=false) {
      bool b;return Boolean.TryParse(Value(d,key),out b)?b:fallback;
    }
    string Email(TextBox box) {
      string value=box.Text.Trim().ToLowerInvariant();
      int at=value.IndexOf('@');
      if(value.Length>254||value.Any(c=>Char.IsWhiteSpace(c)||Char.IsControl(c))||
        at<=0||at!=value.LastIndexOf('@')||at>=value.Length-1||value.IndexOf('.',at+1)<0)
        throw new InvalidOperationException("올바른 이메일 주소를 입력해 주세요.");
      return value;
    }
    string Password(TextBox box) {
      if(box.Text.Length<8||box.Text.Length>128)throw new InvalidOperationException("비밀번호는 8~128자로 입력해 주세요.");
      return box.Text;
    }
    void SetRegistrationReadOnly(bool value) {
      signupName.ReadOnly=value;signupEmail.ReadOnly=value;signupPassword.ReadOnly=value;
    }
    void UpdateUi() {
      if(closing||IsDisposed||action==null)return;
      if(accountMode){action.Enabled=!busy;return;}
      tabs.Enabled=!busy;
      bool verifying=tabs.SelectedIndex==1&&pending;
      action.Text=tabs.SelectedIndex==0?"로그인":verifying?"인증 완료 · 가입":"가입하기";
      action.Enabled=!busy&&(!verifying||
        (DateTime.UtcNow<expiresAt&&verificationCode.Text.Length==6&&verificationCode.Text.All(c=>c>='0'&&c<='9')));
      verificationPanel.Visible=pending;
      if(pending){
        int wait=Math.Max(0,(int)Math.Ceiling((resendAt-DateTime.UtcNow).TotalSeconds));
        int left=Math.Max(0,(int)Math.Ceiling((expiresAt-DateTime.UtcNow).TotalSeconds));
        resend.Enabled=!busy&&wait==0;edit.Enabled=!busy;
        resend.Text=wait>0?"다시 보내기 ("+wait+"초)":"인증번호 다시 보내기";
        verificationHelp.Text=left>0?"받은 편지함의 인증번호를 입력하세요. 남은 시간 "+(left/60)+":"+(left%60).ToString("D2"):
          "인증번호가 만료되었습니다. 다시 보내기를 눌러 주세요.";
      }
    }
    async Task Login() {
      await Perform(async()=>{
        var response=await Send(new Dictionary<string,object>{{"operation","login"},
          {"email",Email(loginEmail)},{"password",Password(loginPassword)}});
        RequireSuccess(response);CompleteAuthentication(response);
      },"로그인하고 있습니다…");
    }
    async Task RequestRegistration() {
      if(busy)return;
      await Perform(async()=>{
        string name=signupName.Text.Trim();
        if(name.Length<1||name.Length>32||name.Any(Char.IsControl))
          throw new InvalidOperationException("게임 이름은 제어문자 없이 1~32자로 입력해 주세요.");
        var response=await Send(new Dictionary<string,object>{{"operation","request"},
          {"email",Email(signupEmail)},{"password",Password(signupPassword)},{"displayName",name}});
        RequireSuccess(response);
        if(!Flag(response,"requiresVerification",true)&&Dict(response,"profile")!=null){
          CompleteAuthentication(response);return;
        }
        pending=true;SetRegistrationReadOnly(true);verificationCode.Clear();
        expiresAt=DateTime.UtcNow.AddSeconds(Math.Max(1,Math.Min(3600,Number(response,"expiresIn",600))));
        resendAt=DateTime.UtcNow.AddSeconds(Math.Max(1,Math.Min(600,Number(response,"resendAfter",60))));
        status.ForeColor=muted;status.Text="이메일로 인증번호를 보냈습니다.";
        verificationCode.Focus();
      },"계정을 만들고 있습니다…");
    }
    async Task Verify() {
      await Perform(async()=>{
        string code=verificationCode.Text;
        if(code.Length!=6||code.Any(c=>c<'0'||c>'9'))throw new InvalidOperationException("숫자 6자리 인증번호를 입력해 주세요.");
        var response=await Send(new Dictionary<string,object>{{"operation","verify"},
          {"email",Email(signupEmail)},{"code",code}});
        RequireSuccess(response);CompleteAuthentication(response);
      },"인증번호를 확인하고 있습니다…");
    }
    void RequireSuccess(Dictionary<string,object> response) {
      if(Flag(response,"ok"))return;
      var error=Dict(response,"error");
      string message=Value(response,"message",Value(error,"message","계정 요청을 처리하지 못했습니다."));
      throw new InvalidOperationException(message);
    }
    void CompleteAuthentication(Dictionary<string,object> response) {
      if(Dict(response,"profile")==null)throw new InvalidOperationException("계정 프로필을 받지 못했습니다. 다시 로그인해 주세요.");
      Authenticated=true;ClearPasswords();DialogResult=DialogResult.OK;Close();
    }
    async Task Perform(Func<Task> operation,string message) {
      if(busy||closing)return;
      busy=true;UseWaitCursor=true;status.ForeColor=muted;status.Text=message;UpdateUi();
      try{await operation();}
      catch(Exception ex){if(!closing&&!IsDisposed){status.ForeColor=warning;status.Text=ex.Message;}}
      finally{busy=false;if(!closing&&!IsDisposed){UseWaitCursor=false;UpdateUi();}}
    }
    async Task<Dictionary<string,object>> Send(Dictionary<string,object> request) {
      string cli=Path.Combine(support,"central-auth.mjs");
      if(!File.Exists(cli))throw new FileNotFoundException("계정 연결 도구가 없습니다.",cli);
      // Credentials travel only through the child process's stdin, never files or arguments.
      string input=json.Serialize(request);
      Dictionary<string,object> response;
      try{response=await Task.Run(()=>{
        var stdout=new StringBuilder();var stderr=new StringBuilder();object sync=new object();
        using(var p=new Process()){
          p.StartInfo=new ProcessStartInfo{FileName=nodePath,Arguments="\""+cli+"\" "+host+" "+port,
            UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,
            RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,
            StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
          p.OutputDataReceived+=(s,e)=>{if(e.Data!=null)lock(sync){if(stdout.Length<65536)stdout.AppendLine(e.Data);}};
          p.ErrorDataReceived+=(s,e)=>{if(e.Data!=null)lock(sync){if(stderr.Length<65536)stderr.AppendLine(e.Data);}};
          if(!p.Start())throw new InvalidOperationException("계정 연결 도구를 시작할 수 없습니다.");
          p.BeginOutputReadLine();p.BeginErrorReadLine();
          byte[] inputBytes=Encoding.UTF8.GetBytes(input+"\n");
          try{p.StandardInput.BaseStream.Write(inputBytes,0,inputBytes.Length);p.StandardInput.BaseStream.Flush();}
          finally{Array.Clear(inputBytes,0,inputBytes.Length);p.StandardInput.Close();}
          var clock=Stopwatch.StartNew();
          while(!p.WaitForExit(100)){
            if(closing||clock.ElapsedMilliseconds>=30000){
              try{p.Kill();p.WaitForExit(1000);}catch{}
              throw new InvalidOperationException(closing?"계정 요청을 취소했습니다.":"서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.");
            }
          }
          // Child has exited; allow asynchronous readers to deliver their final JSON line.
          p.WaitForExit();
          lock(sync){
            foreach(string text in new[]{stdout.ToString(),stderr.ToString()}){
              try{var parsed=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(text.Trim());
                if(parsed!=null&&parsed.ContainsKey("ok"))return parsed;}catch{}
            }
          }
          throw new InvalidOperationException("계정 서버 응답을 확인할 수 없습니다. 서버 주소와 연결 상태를 확인해 주세요.");
        }
      });}finally{input=null;request.Clear();}
      if(closing||IsDisposed)throw new OperationCanceledException();
      return response;
    }
    public void ShowAccount(Dictionary<string,object> profile) {
      accountMode=true;Text="카르마 · 계정";
      foreach(Control c in Controls.Cast<Control>().ToArray()){Controls.Remove(c);c.Dispose();}
      ClientSize=new Size(520,330);
      var panel=new Panel{Dock=DockStyle.Fill,AutoScroll=true};Controls.Add(panel);
      var grid=FormGrid(panel);
      grid.Controls.Add(TextLabel(Value(profile,"name",Value(profile,"displayName","카르마 계정")),true));
      grid.Controls.Add(TextLabel(Value(profile,"email")));
      grid.Controls.Add(TextLabel("서버 "+host+":"+port+"\nXP "+Number(profile,"xp",0).ToString("N0")));
      status=TextLabel("");grid.Controls.Add(status);
      var buttons=new FlowLayoutPanel{Dock=DockStyle.Top,AutoSize=true,FlowDirection=FlowDirection.RightToLeft};
      var close=MakeButton("닫기");close.DialogResult=DialogResult.Cancel;
      action=MakeButton("로그아웃");buttons.Controls.Add(close);buttons.Controls.Add(action);grid.Controls.Add(buttons);
      AcceptButton=close;CancelButton=close;
      action.Click+=async(s,e)=>await Perform(async()=>{
        var response=await Send(new Dictionary<string,object>{{"operation","logout"}});
        RequireSuccess(response);SignedOut=true;DialogResult=DialogResult.OK;Close();
      },"로그아웃하고 있습니다…");
    }
    void ClearPasswords() {
      if(loginPassword!=null&&!loginPassword.IsDisposed)loginPassword.Clear();
      if(signupPassword!=null&&!signupPassword.IsDisposed)signupPassword.Clear();
    }
    protected override void Dispose(bool disposing) {
      if(disposing){closing=true;timer.Stop();timer.Dispose();ClearPasswords();}
      base.Dispose(disposing);
    }
  }
}
