using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Collections;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace KarmaLocal {
  public static class InputSettingsDialog {
    public static void Show(IWin32Window owner){
      var serializer=new JavaScriptSerializer();
      string folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"KarmaLAN"),file=Path.Combine(folder,"input-settings.json");
      var settings=new Dictionary<string,object>();try{settings=serializer.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));}catch{}
      bool remote=SystemInformation.TerminalServerSession;object value;
      if(settings.TryGetValue("remoteMode",out value)&&value is bool)remote=(bool)value;
      decimal sensitivity=remote?25:100;try{if(settings.TryGetValue("sensitivity",out value))sensitivity=Convert.ToDecimal(value)*100;}catch{}
      using(var dialog=new Form{Text="이 PC의 마우스 · 화면",ClientSize=new Size(460,240),StartPosition=FormStartPosition.CenterParent,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,MinimizeBox=false,Font=new Font("Malgun Gothic",10)}){
        var mode=new CheckBox{Text="원격 호환 모드 · 원본 800×600 화면 유지",Checked=remote,Left=20,Top=20,Width=420};
        var label=new Label{Text="마우스 감도 (%)",Left=20,Top=66,Width=200};
        var amount=new NumericUpDown{Minimum=5,Maximum=200,Value=Math.Max(5,Math.Min(200,sensitivity)),Increment=5,Left=230,Top=62,Width=100};
        var help=new Label{Text="다음 게임 실행부터 적용됩니다. 원격 접속에서는\n감도 25%부터 조절해 보세요. 이 PC에만 저장됩니다.",Left=20,Top=108,Width=420,Height=56};
        var save=new Button{Text="저장",Left=320,Top=180,Width=110,DialogResult=DialogResult.OK};
        dialog.Controls.AddRange(new Control[]{mode,label,amount,help,save});dialog.AcceptButton=save;
        if(dialog.ShowDialog(owner)==DialogResult.OK){Directory.CreateDirectory(folder);File.WriteAllText(file,serializer.Serialize(new {remoteMode=mode.Checked,sensitivity=(double)amount.Value/100}),Encoding.UTF8);}
      }
    }
  }
  public sealed class PauseWindow : Form {
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    readonly string commandPath;
    readonly IntPtr gameWindow;
    readonly int gamePid;
    readonly System.Windows.Forms.Timer watcher;
    string choice="";
    public PauseWindow(string path,string hwnd,int pid,bool lan,bool confirmExit=false) {
      string allowed=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Launcher"))+Path.DirectorySeparatorChar;
      commandPath=Path.GetFullPath(path);
      if(!commandPath.StartsWith(allowed,StringComparison.OrdinalIgnoreCase)||
         !Path.GetFileName(commandPath).StartsWith("pause-",StringComparison.Ordinal))
        throw new InvalidDataException("일시 정지 명령 경로가 올바르지 않습니다.");
      gameWindow=new IntPtr(Convert.ToInt64(hwnd.Replace("0x",""),16));gamePid=pid;
      Text=lan?"카르마 · LAN 메뉴":"카르마 · 일시 정지";ClientSize=new Size(410,lan?310:235);FormBorderStyle=FormBorderStyle.FixedDialog;
      AutoScaleMode=AutoScaleMode.Dpi;StartPosition=FormStartPosition.CenterScreen;
      MaximizeBox=false;MinimizeBox=false;TopMost=true;KeyPreview=true;
      BackColor=Color.FromArgb(21,29,35);ForeColor=Color.White;Font=new Font("Malgun Gothic",11);
      var heading=new Label{Text=(lan?"LAN 메뉴 · 대전은 계속됩니다.":"일시 정지")+"\n내 코인   "+CoinHud.ReadBalance(),Location=new Point(24,22),Size=new Size(362,70)};
      Controls.Add(heading);
      Button resume=new Button{Text="계속  (F10)",Location=new Point(24,115),Size=new Size(170,48)};
      Button exit=new Button{Text="게임 종료…",Location=new Point(210,115),Size=new Size(176,48)};
      var matchStatus=new Label{Location=new Point(24,91),Size=new Size(362,80),ForeColor=Color.FromArgb(223,184,105)};
      if(lan){Controls.Add(matchStatus);resume.Top=190;exit.Top=190;}
      Controls.Add(resume);Controls.Add(exit);AcceptButton=resume;
      var settingsButton=new Button{Text="마우스 · 화면 설정 (다음 게임부터 적용)",Location=new Point(24,lan?245:170),Size=new Size(362,36)};
      settingsButton.Click+=(s,e)=>InputSettingsDialog.Show(this);Controls.Add(settingsButton);
      Action showConfirmation=()=>{
        confirmExit=true;Text="카르마 · 종료 확인";
        heading.Text=(lan?"대전을 종료하시겠습니까?":"사격 연습을 종료하시겠습니까?")+"\n내 코인   "+CoinHud.ReadBalance();
        resume.Text="계속하기 (Esc)";exit.Text="종료";
        matchStatus.Text="확인 중에도 LAN 대전은 계속됩니다.";
        AcceptButton=resume;resume.Focus();
      };
      if(confirmExit)showConfirmation();
      resume.Click+=(s,e)=>Submit("resume");
      exit.Click+=(s,e)=>{if(confirmExit)Submit("quit");else showConfirmation();};
      KeyDown+=(s,e)=>{
        if(e.KeyCode==Keys.F2||e.KeyCode==Keys.F10||e.KeyCode==Keys.Escape){
          e.Handled=true;e.SuppressKeyPress=true;
          if(e.KeyCode==Keys.F2||e.KeyCode==Keys.F10||confirmExit)Submit("resume");else showConfirmation();
        }
      };
      Shown+=(s,e)=>{Activate();resume.Focus();};
      FormClosing+=(s,e)=>{if(choice=="")WriteChoice("resume");};
      FormClosed+=(s,e)=>{watcher.Stop();watcher.Dispose();if(choice=="resume")SetForegroundWindow(gameWindow);};
      watcher=new System.Windows.Forms.Timer{Interval=700};
      watcher.Tick+=(s,e)=>{
        try{using(Process p=Process.GetProcessById(gamePid)){if(p.HasExited)Close();}}catch{Close();}
        if(lan&&!confirmExit)try{var value=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(allowed,"lan-status.json")));matchStatus.Text=Convert.ToString(value["message"]);}catch{}
      };
      watcher.Start();
    }
    void WriteChoice(string value){File.WriteAllText(commandPath,"{\"action\":\""+value+"\"}",Encoding.UTF8);choice=value;}
    void Submit(string value){WriteChoice(value);Close();}
  }
  public sealed class LanSetup : Form {
    public string Host="",Code="",RoomName="";
    public int Port=29020,MaxPlayers=2,KillLimit=10,RoundWinLimit=5,TimeLimitSeconds=600;
    public string MatchMode="duel";
    public string AddressDisplay {get{return address.Text;}}
    readonly TextBox address,code,roomName;
    public LanSetup(bool host,string support,int maxSeats=8) {
      Text=host?"중앙 서버 · 방 만들기":"중앙 서버 · 참가";ClientSize=new Size(560,800);
      AutoScaleDimensions=new SizeF(96F,96F);AutoScaleMode=AutoScaleMode.Dpi;Font=new Font("Malgun Gothic",10);
      FormBorderStyle=FormBorderStyle.Sizable;StartPosition=FormStartPosition.CenterParent;
      MaximizeBox=false;MinimizeBox=false;
      string server="192.168.12.100";
      string serverPath=Path.Combine(support,"server-selection.json");
      var serializer=new JavaScriptSerializer();
      try{
        var saved=serializer.Deserialize<Dictionary<string,object>>(File.ReadAllText(serverPath,Encoding.UTF8));
        object value;IPAddress savedIp;
        if(saved.TryGetValue("host",out value)&&IPAddress.TryParse(Convert.ToString(value),out savedIp)&&
           savedIp.AddressFamily==AddressFamily.InterNetwork&&!savedIp.Equals(IPAddress.Any)&&!savedIp.Equals(IPAddress.Broadcast))
          server=savedIp.ToString();
      }catch{}
      var panel=new TableLayoutPanel{Dock=DockStyle.Fill,AutoScroll=true,ColumnCount=1,Padding=new Padding(24)};
      panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));Controls.Add(panel);
      panel.Controls.Add(new Label{Text=host?"같은 중앙 서버에 접속한 상대에게 방 코드를 알려 주세요.":"방장과 같은 중앙 서버 주소와 방 코드를 입력하세요.",
        AutoSize=true,Dock=DockStyle.Fill,Margin=new Padding(0,0,0,18)});
      panel.Controls.Add(new Label{Text="중앙 서버 IP 주소",AutoSize=true,Margin=new Padding(0,0,0,5)});
      address=new TextBox{Text=server,Dock=DockStyle.Top,Margin=new Padding(0,0,0,16)};
      panel.Controls.Add(address);
      roomName=new TextBox{Text="함께하는 카르마",MaxLength=32,Dock=DockStyle.Top,Margin=new Padding(0,0,0,16)};
      if(host){panel.Controls.Add(new Label{Text="방 이름 (최대 32자)",AutoSize=true,Margin=new Padding(0,0,0,5)});panel.Controls.Add(roomName);}
      panel.Controls.Add(new Label{Text="방 코드 (6자리)",AutoSize=true,Margin=new Padding(0,0,0,5)});
      byte[] random=new byte[4];using(var rng=RandomNumberGenerator.Create())rng.GetBytes(random);
      code=new TextBox{Text=host?(BitConverter.ToUInt32(random,0)%1000000).ToString("D6"):"",
        MaxLength=6,Width=190,Margin=new Padding(0,0,0,16)};
      panel.Controls.Add(code);
      var matchMode=new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Dock=DockStyle.Top,Margin=new Padding(0,0,0,12)};
      matchMode.Items.AddRange(new object[]{"1:1 대전 (2명)","팀전 (최대 "+(maxSeats/2)+":"+(maxSeats/2)+" · 전멸전)","개인 데스매치 (2~"+maxSeats+"명)"});matchMode.SelectedIndex=0;
      var capacity=new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Width=180,Margin=new Padding(0,0,0,16)};
      for(int seat=2;seat<=maxSeats;seat++)capacity.Items.Add(seat);capacity.SelectedIndex=capacity.Items.Count-1;capacity.Enabled=false;
      if(host){
        panel.Controls.Add(new Label{Text="대전 방식",AutoSize=true});panel.Controls.Add(matchMode);
        panel.Controls.Add(new Label{Text="개인전 최대 인원",AutoSize=true});panel.Controls.Add(capacity);
      }
      var killLimit=new NumericUpDown{Name="KillLimit",Minimum=1,Maximum=30,Value=10,Width=160};
      var roundLimit=new NumericUpDown{Name="RoundWinLimit",Minimum=1,Maximum=10,Value=5,Width=160};
      var timeLimit=new NumericUpDown{Name="TimeLimitMinutes",Minimum=1,Maximum=30,Value=10,Width=160};
      var goalLabel=new Label{Text="목표 킬 (1~30킬)",AutoSize=true};
      var goals=new FlowLayoutPanel{Dock=DockStyle.Top,AutoSize=true,Margin=new Padding(0,0,0,12)};
      goals.Controls.Add(killLimit);goals.Controls.Add(roundLimit);roundLimit.Visible=false;
      if(host){panel.Controls.Add(goalLabel);panel.Controls.Add(goals);panel.Controls.Add(new Label{Text="제한 시간 (1~30분)",AutoSize=true});panel.Controls.Add(timeLimit);}
      matchMode.SelectedIndexChanged+=(s,e)=>{capacity.Enabled=matchMode.SelectedIndex==2;bool team=matchMode.SelectedIndex==1;killLimit.Visible=!team;roundLimit.Visible=team;goalLabel.Text=team?"목표 라운드 승수 (1~10승)":"목표 킬 (1~30킬)";};
      panel.Controls.Add(new Label{Text=host?"최소 인원이 모이고 모두 준비 완료하면 방장이 시작합니다.\n팀전: 짝수 인원 · 양끝 시작 · 라운드 종료 후 부활\n개인전: 사망 10초 후 랜덤 부활":"대기실에 입장한 뒤 장비를 설정하고 준비 완료를 누르세요.",
        AutoSize=true,Dock=DockStyle.Fill,Margin=new Padding(0,0,0,18)});
      var buttons=new FlowLayoutPanel{Dock=DockStyle.Top,AutoSize=true,FlowDirection=FlowDirection.RightToLeft};
      Button go=new Button{Text="대기실 만들기 →",Size=new Size(150,36)};
      Button cancel=new Button{Text="취소",Size=new Size(94,36),DialogResult=DialogResult.Cancel};
      buttons.Controls.Add(go);buttons.Controls.Add(cancel);panel.Controls.Add(buttons);AcceptButton=go;CancelButton=cancel;
      go.Click+=(s,e)=>{
        IPAddress ip;
        if(!IPAddress.TryParse(address.Text.Trim(),out ip)||ip.AddressFamily!=AddressFamily.InterNetwork||
          ip.Equals(IPAddress.Any)||ip.Equals(IPAddress.Broadcast)){
          MessageBox.Show(this,"접속할 중앙 서버의 IPv4 주소를 입력해 주세요.");return;
        }
        if(code.Text.Length!=6||code.Text.Any(c=>c<'0'||c>'9')){MessageBox.Show(this,"숫자 6자리 방 코드를 입력해 주세요.");return;}
        if(host&&(String.IsNullOrWhiteSpace(roomName.Text)||roomName.Text.Any(Char.IsControl))){MessageBox.Show(this,"방 이름을 입력해 주세요.");return;}
        Host=ip.ToString();Code=code.Text;RoomName=roomName.Text.Trim();
        MatchMode=matchMode.SelectedIndex==1?"tdm":matchMode.SelectedIndex==2?"dm":"duel";
        MaxPlayers=MatchMode=="tdm"?maxSeats:MatchMode=="dm"?Convert.ToInt32(capacity.SelectedItem):2;
        KillLimit=(int)killLimit.Value;RoundWinLimit=(int)roundLimit.Value;TimeLimitSeconds=(int)timeLimit.Value*60;
        try{File.WriteAllText(serverPath,serializer.Serialize(new Dictionary<string,object>{{"host",Host},{"port",Port}}),Encoding.UTF8);}
        catch(Exception ex){MessageBox.Show(this,"서버 주소를 저장할 수 없습니다.\n"+ex.Message);return;}
        DialogResult=DialogResult.OK;Close();
      };
      Shown+=(s,e)=>{
        Rectangle area=Screen.FromControl(Owner??this).WorkingArea;
        Size=new Size(Math.Min(Width,Math.Max(1,area.Width-24)),Math.Min(Height,Math.Max(1,area.Height-24)));
        Location=new Point(area.Left+(area.Width-Width)/2,area.Top+(area.Height-Height)/2);
        if(host)address.Focus();else code.Focus();
      };
    }
  }
  public sealed class RoomSettingsDialog : Form {
    readonly ComboBox mapBox=new ComboBox(),modeBox=new ComboBox();
    readonly TextBox roomName=new TextBox();
    readonly NumericUpDown seats=new NumericUpDown(),kills=new NumericUpDown(),rounds=new NumericUpDown(),minutes=new NumericUpDown();
    readonly List<Dictionary<string,object>> mapChoices=new List<Dictionary<string,object>>();
    static int Num(Dictionary<string,object> d,string k,int fallback){object v;int n;return d.TryGetValue(k,out v)&&Int32.TryParse(Convert.ToString(v),out n)?n:fallback;}
    static string Str(Dictionary<string,object> d,string k){object v;return d.TryGetValue(k,out v)?Convert.ToString(v):"";}
    public Dictionary<string,object> Settings {get{return new Dictionary<string,object>{{"map",Num(mapChoices[mapBox.SelectedIndex],"map",0)},{"roomName",roomName.Text},{"mode",new[]{"duel","dm","tdm"}[modeBox.SelectedIndex]},{"maxPlayers",(int)seats.Value},{"killLimit",(int)kills.Value},{"roundWinLimit",(int)rounds.Value},{"timeLimitSeconds",(int)minutes.Value*60}};}}
    public RoomSettingsDialog(Dictionary<string,object> state){
      Text="방 설정 · 맵 변경";ClientSize=new Size(490,470);AutoScaleMode=AutoScaleMode.Dpi;StartPosition=FormStartPosition.CenterParent;FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;MinimizeBox=false;Font=new Font("Malgun Gothic",10);
      object options;if(state.TryGetValue("availableMaps",out options)&&options is IEnumerable)foreach(object item in (IEnumerable)options){var map=item as Dictionary<string,object>;if(map!=null)mapChoices.Add(map);}
      if(mapChoices.Count==0)throw new InvalidOperationException("변경 가능한 맵 목록이 없습니다. 다시 접속해 주세요.");
      mapBox.DropDownStyle=modeBox.DropDownStyle=ComboBoxStyle.DropDownList;
      foreach(var map in mapChoices)mapBox.Items.Add(Str(map,"name")+" · 최대 "+Num(map,"maxPlayers",8)+"명");
      mapBox.SelectedIndex=Math.Max(0,mapChoices.FindIndex(m=>Num(m,"map",-1)==Num(state,"map",-2)));
      modeBox.Items.AddRange(new object[]{"1:1 대전","개인 데스매치","팀 전멸전"});modeBox.SelectedIndex=Str(state,"mode")=="tdm"?2:Str(state,"mode")=="dm"?1:0;
      roomName.MaxLength=32;roomName.Text=Str(state,"roomName");
      seats.Minimum=2;seats.Maximum=8;seats.Value=Math.Max(2,Math.Min(8,Num(state,"maxPlayers",2)));
      kills.Minimum=1;kills.Maximum=30;kills.Value=Math.Max(1,Math.Min(30,Num(state,"killLimit",10)));
      rounds.Minimum=1;rounds.Maximum=10;rounds.Value=Math.Max(1,Math.Min(10,Num(state,"roundWinLimit",5)));
      minutes.Minimum=1;minutes.Maximum=30;minutes.Value=Math.Max(1,Math.Min(30,Num(state,"timeLimitSeconds",600)/60));
      var labels=new[]{"방 이름","맵","대전 방식","최대 인원","목표 킬 수","팀전 목표 승수","제한 시간 (분)"};Control[] fields={roomName,mapBox,modeBox,seats,kills,rounds,minutes};
      for(int i=0;i<fields.Length;i++){Controls.Add(new Label{Text=labels[i],Left=20,Top=22+i*45,Width=135});fields[i].SetBounds(160,18+i*45,305,30);Controls.Add(fields[i]);}
      Controls.Add(new Label{Text="변경하면 모든 참가자의 준비가 해제됩니다.\n팀전 정원은 짝수이며 현재 참가자보다 줄일 수 없습니다.",Left=20,Top=337,Width=450,Height=52});
      Action sync=()=>{seats.Maximum=modeBox.SelectedIndex==0?2:Num(mapChoices[mapBox.SelectedIndex],"maxPlayers",8);seats.Enabled=modeBox.SelectedIndex!=0;kills.Enabled=modeBox.SelectedIndex!=2;rounds.Enabled=modeBox.SelectedIndex==2;};
      modeBox.SelectedIndexChanged+=(s,e)=>sync();mapBox.SelectedIndexChanged+=(s,e)=>sync();sync();
      var save=new Button{Text="변경 적용",Left=240,Top=410,Width=110};var cancel=new Button{Text="취소",Left=360,Top=410,Width=105,DialogResult=DialogResult.Cancel};
      save.Click+=(s,e)=>{if(seats.Value<Num(state,"players",1)||(modeBox.SelectedIndex==2&&seats.Value%2!=0)){MessageBox.Show(this,"참가자 수 이상으로, 팀전은 짝수 정원으로 설정해 주세요.");return;}DialogResult=DialogResult.OK;Close();};Controls.Add(save);Controls.Add(cancel);AcceptButton=save;CancelButton=cancel;
    }
  }
  public sealed class LobbyWindow : Form {
    readonly Label title,info;
    readonly ListBox members;
    readonly Button begin,readyButton,equipment;
    readonly Action<string> requestStart;
    readonly Func<string,bool,Task> requestReady;
    readonly Func<string,Task> changeEquipment;
    readonly Func<string,Dictionary<string,object>,Task> changeRoom;
    readonly Button roomSettings;
    readonly Action leave;
    readonly ChatPanel chat;
    string roomId="";
    bool dismissing,busy,selfReady;
    Dictionary<string,object> lastData;
    static string Read(Dictionary<string,object> data,string key){object v;return data.TryGetValue(key,out v)?Convert.ToString(v):"";}
    static bool Flag(Dictionary<string,object> data,string key){object v;return data.TryGetValue(key,out v)&&v is bool&&(bool)v;}
    public LobbyWindow(Action<string> startMatch,Func<string,bool,Task> ready,Func<string,Task> equipmentChange,Action leaveRoom,string support=null,Func<string,Dictionary<string,object>,Task> editRoom=null) {
      changeRoom=editRoom;requestStart=startMatch;requestReady=ready;changeEquipment=equipmentChange;leave=leaveRoom;
      Text="카르마 · 대기실";ClientSize=new Size(720,820);MinimumSize=new Size(540,600);
      AutoScaleDimensions=new SizeF(96F,96F);AutoScaleMode=AutoScaleMode.Dpi;
      StartPosition=FormStartPosition.CenterParent;Font=new Font("Malgun Gothic",11);
      BackColor=Color.FromArgb(21,29,35);ForeColor=Color.White;MinimizeBox=false;MaximizeBox=false;
      var panel=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=6,Padding=new Padding(22)};
      panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      panel.RowStyles.Add(new RowStyle(SizeType.Absolute,94));panel.RowStyles.Add(new RowStyle(SizeType.Percent,35));panel.RowStyles.Add(new RowStyle(SizeType.Percent,65));
      panel.RowStyles.Add(new RowStyle(SizeType.Absolute,108));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,48));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,58));Controls.Add(panel);
      title=new Label{Dock=DockStyle.Fill,Font=new Font("Malgun Gothic",13,FontStyle.Bold),AutoEllipsis=true};panel.Controls.Add(title,0,0);
      members=new ListBox{Dock=DockStyle.Fill,IntegralHeight=false,BackColor=Color.FromArgb(30,40,48),ForeColor=Color.White,BorderStyle=BorderStyle.FixedSingle};panel.Controls.Add(members,0,1);
      chat=new ChatPanel(support??ChatFiles.Support);panel.Controls.Add(chat,0,2);
      info=new Label{Dock=DockStyle.Fill,Padding=new Padding(0,12,0,0),ForeColor=Color.FromArgb(222,181,100)};panel.Controls.Add(info,0,3);
      var preparation=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=3};for(int i=0;i<3;i++)preparation.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,33.33f));panel.Controls.Add(preparation,0,4);
      equipment=new Button{Text="장비 설정",Dock=DockStyle.Fill};readyButton=new Button{Text="준비 완료",Dock=DockStyle.Fill};preparation.Controls.Add(equipment,0,0);preparation.Controls.Add(readyButton,1,0);
      roomSettings=new Button{Text="방 설정 · 맵 변경",Dock=DockStyle.Fill,Enabled=false};preparation.Controls.Add(roomSettings,2,0);
      roomSettings.Click+=async(s,e)=>await Perform(()=>changeRoom(roomId,lastData));
      equipment.Click+=async(s,e)=>await Perform(()=>changeEquipment(roomId));
      readyButton.Click+=async(s,e)=>await Perform(()=>requestReady(roomId,!selfReady));
      var buttons=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2};buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,38));buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,62));panel.Controls.Add(buttons,0,5);
      var cancel=new Button{Text="방 나가기",Dock=DockStyle.Fill};buttons.Controls.Add(cancel,0,0);
      begin=new Button{Text="대전 시작",Dock=DockStyle.Fill,Enabled=false,BackColor=Color.FromArgb(222,181,100),ForeColor=Color.FromArgb(25,28,26)};buttons.Controls.Add(begin,1,0);
      cancel.Click+=(s,e)=>Close();begin.Click+=(s,e)=>{
        try{requestStart(roomId);begin.Enabled=false;info.Text="시작 요청을 보냈습니다…";}
        catch(Exception ex){MessageBox.Show(this,"시작 요청을 보낼 수 없습니다.\n"+ex.Message);}
      };
      FormClosing+=(s,e)=>{if(!dismissing)leave();};
      Shown+=(s,e)=>{var area=Screen.FromControl(Owner??this).WorkingArea;Size=new Size(Math.Min(Width,area.Width-24),Math.Min(Height,area.Height-24));Location=new Point(area.Left+(area.Width-Width)/2,area.Top+(area.Height-Height)/2);};
    }
    async Task Perform(Func<Task> action){
      if(busy)return;busy=true;if(lastData!=null)UpdateLobby(lastData);
      try{await action();}catch(Exception ex){if(!IsDisposed)MessageBox.Show(this,ex.Message,"대기실",MessageBoxButtons.OK,MessageBoxIcon.Information);}
      finally{busy=false;if(!IsDisposed&&lastData!=null)UpdateLobby(lastData);}
    }
    public void UpdateLobby(Dictionary<string,object> data) {
      lastData=data;
      roomId=Read(data,"roomId");bool host=Flag(data,"isHost"),manual=Flag(data,"manualStart");
      string mode=Read(data,"mode"),modeName=mode=="tdm"?"팀 전멸전":mode=="dm"?"개인 데스매치":"1:1 대전";
      chat.SetMode(mode);
      string roomName=Read(data,"roomName");int seconds;Int32.TryParse(Read(data,"timeLimitSeconds"),out seconds);
      string limits=(mode=="tdm"?Read(data,"roundWinLimit")+"승":Read(data,"killLimit")+"킬")+" / "+(seconds/60)+"분";
      title.Text=(roomName==""?"카르마 대기실":roomName)+"    ·    "+Read(data,"players")+" / "+Read(data,"maxPlayers")+"명\n코드 "+Read(data,"code")+" · "+modeName+(host?" · 방장":"")+"\n"+Read(data,"mapName")+" · 종료 조건: "+limits+" 중 먼저 도달";
      var lines=new List<string>();object roster;selfReady=false;
      if(data.TryGetValue("members",out roster)&&roster is IEnumerable)foreach(object item in (IEnumerable)roster){
        var member=item as Dictionary<string,object>;if(member==null)continue;
        string team=mode=="tdm"?(Read(member,"team")=="0"?"[RED]  ":"[BLUE]  "):"";
        bool mine=Read(member,"playerId")==Read(data,"localPlayerId");if(mine)selfReady=Flag(member,"ready");
        lines.Add((Flag(member,"ready")?"[준비 완료]  ":"[준비 중]  ")+team+Read(member,"name")+(mine?" (나)":"")+(Read(member,"playerId")==Read(data,"hostId")?"   (방장)":""));
      }
      if(!members.Items.Cast<object>().Select(Convert.ToString).SequenceEqual(lines)){
        members.BeginUpdate();members.Items.Clear();members.Items.AddRange(lines.Cast<object>().ToArray());members.EndUpdate();
      }
      begin.Text=host?"대전 시작 →":"방장 시작 대기";begin.Enabled=!busy&&host&&manual&&Flag(data,"canStart");
      roomSettings.Visible=host;roomSettings.Enabled=!busy&&host&&changeRoom!=null&&Flag(data,"roomSettingsEditable");
      equipment.Enabled=!busy;readyButton.Enabled=!busy;readyButton.Text=selfReady?"준비 취소":"준비 완료";
      info.Text=Read(data,"message")+(host&&!Flag(data,"canStart")?"\n"+Read(data,"startReason"):"")+(Read(data,"gameFee")=="100"?"\n대전 시작 시 1인당 1 KARMA · 대기실 입장은 무료":"");
    }
    public void Dismiss(){dismissing=true;Close();}
  }
  public class CatalogItem {
    public Dictionary<string,object> Data;
    public string Id { get { return Read("id"); } }
    public string Name { get { string s=Read("displayName"); return s!=""?s:Read("name"); } }
    public string Read(string key) { object o; return Data.TryGetValue(key,out o)&&o!=null?Convert.ToString(o):""; }
    public int Number(string key,int fallback) { int n; return Int32.TryParse(Read(key),out n)?n:fallback; }
    public int Age { get { string a=Read("age"); return a=="Future"||a=="future"?1:Number("age",0); } }
    public Dictionary<string,object> Dict(string key) { object o; return Data.TryGetValue(key,out o)?o as Dictionary<string,object>:null; }
  }
  public class Tile : Panel {
    public CatalogItem Item;
    public bool Selected;
    public Action<Tile> Pick;
    public Tile(CatalogItem item,Image image,string subtitle,bool portrait,bool locked=false) {
      Item=item; Width=190; Height=portrait?244:184; Margin=new Padding(7);
      BackColor=Color.FromArgb(30,37,42); Cursor=Cursors.Hand;
      PictureBox pic=new PictureBox {Image=image,SizeMode=PictureBoxSizeMode.Zoom,
        Location=new Point(9,9),Size=new Size(172,portrait?168:108),BackColor=Color.FromArgb(20,25,29)};
      Label title=new Label {Text=(locked?"잠금 · ":"")+item.Name,Location=new Point(12,portrait?184:125),Size=new Size(166,23),
        Font=new Font("Malgun Gothic",10,FontStyle.Bold),ForeColor=locked?Color.FromArgb(151,165,170):Color.FromArgb(238,237,226),AutoEllipsis=true};
      Label sub=new Label {Text=subtitle,Location=new Point(12,portrait?211:151),Size=new Size(166,20),
        Font=new Font("Malgun Gothic",8),ForeColor=Color.FromArgb(151,165,170),AutoEllipsis=true};
      Controls.Add(pic); Controls.Add(title); Controls.Add(sub);
      Click+=Clicked; foreach(Control c in Controls)c.Click+=Clicked;
      Paint+=(s,e)=>{using(Pen p=new Pen(Selected?Color.FromArgb(222,181,100):Color.FromArgb(48,59,66),Selected?2:1))
        e.Graphics.DrawRectangle(p,1,1,Width-3,Height-3);};
    }
    void Clicked(object s,EventArgs e){if(Pick!=null)Pick(this);}
  }
  public class Launcher : Form {
    readonly string root, game, support;
    readonly JavaScriptSerializer json=new JavaScriptSerializer();
    Dictionary<string,object> catalog, runtime, loadoutData, cachedProfile,multiplayerMaps;
    List<CatalogItem> maps,characters,weapons;
    readonly Dictionary<string,Image> images=new Dictionary<string,Image>(StringComparer.OrdinalIgnoreCase);
    CatalogItem map,character,weapon;
    int age, tab;
    bool initializing=true;
    ComboBox modes,eras;
    TextBox search;
    FlowLayoutPanel grid;
    RoomDirectory roomDirectory;
    Label heading, count, summary, status, selection, characterName, characterCamp, weaponInfo, rankInfo;
    Label myName,myRank,myXp,myResults,myMatches,myKd,myRatio,myWinrate,mySync;
    PictureBox portrait;
    Button start, loadoutButton, accountButton, refreshStats;
    Button musicButton;
    readonly MenuMusic menuMusic;
    Button[] tabs;
    TableLayoutPanel contentLayout;
    System.Windows.Forms.Timer watcher;
    Process sessionHelper;
    LobbyWindow lobby;
    Dictionary<string,object> lobbyConfig;
    bool sessionActive, sessionObservedGame, sessionLan, configuringLan, lobbyLeaving;
    bool refreshingStats,profileLoginRequired;
    string profileSyncMessage="저장된 기록 · 서버 확인 전";
    volatile bool closingLauncher;
    string lanDetails="";
    DateTime sessionStartedUtc;
    FormWindowState restoreState=FormWindowState.Normal;
    string sessionError="";
    int profileXp,profileRankXp;
    Color accent=Color.FromArgb(222,181,100), ink=Color.FromArgb(235,238,235), muted=Color.FromArgb(153,167,171);
    public Launcher() {
      root=AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
      game=Path.Combine(root,"App_Executables"); support=Path.Combine(root,"Launcher");
      menuMusic=new MenuMusic(Path.Combine(game,"Data","Sound","Music","menu.wma"),new MciMenuMusicPlayer());
      catalog=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(support,"catalog.json"),Encoding.UTF8));
      runtime=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(support,"runtime.json"),Encoding.UTF8));
      loadoutData=ReadSupportJson("loadouts.json");
      multiplayerMaps=ReadSupportJson("multiplayer-maps.json");
      RefreshCentralProfile();
      maps=Items("maps"); characters=Items("characters"); weapons=Items("weapons");
      Text="카르마 v"+ReleaseTrust.Version+" · 로컬 플레이"; ClientSize=new Size(1160,810); MinimumSize=new Size(1020,720);
      StartPosition=FormStartPosition.CenterScreen; BackColor=Color.FromArgb(16,22,27); ForeColor=ink;
      Font=new Font("Malgun Gothic",9); AutoScaleMode=AutoScaleMode.Dpi;
      string icon=Path.Combine(game,"Maburi1.ico"); if(File.Exists(icon))try{Icon=new Icon(icon);}catch{}
      Build(); LoadPreferences();
      if(Environment.GetCommandLineArgs().Contains("--practice")){age=0;eras.SelectedIndex=0;modes.SelectedIndex=2;}
      if(Environment.GetCommandLineArgs().Contains("--ai")){age=0;eras.SelectedIndex=0;modes.SelectedIndex=3;}
      if(Environment.GetCommandLineArgs().Contains("--lan-host"))modes.SelectedIndex=4;
      if(Environment.GetCommandLineArgs().Contains("--lan-join"))modes.SelectedIndex=5;
      initializing=false; SelectDefaults(); RefreshCards();
      watcher=new System.Windows.Forms.Timer{Interval=1200};
      watcher.Tick+=(s,e)=>UpdateRunning(); watcher.Start();
      Shown+=async(s,e)=>{FitWorkingArea();await SyncMyStats();if(JoinMode)await roomDirectory.RefreshRooms();};
      FormClosing+=(s,e)=>{closingLauncher=true;menuMusic.Dispose();};
      FormClosed+=(s,e)=>{watcher.Stop();if(sessionActive&&sessionLan)CancelLan();SavePreferences();if(sessionHelper!=null)sessionHelper.Dispose();foreach(Image i in images.Values)i.Dispose();};
    }
    List<CatalogItem> Items(string name) {
      object v; if(!catalog.TryGetValue(name,out v))return new List<CatalogItem>();
      return ((IEnumerable)v).Cast<object>().Select(x=>new CatalogItem{Data=(Dictionary<string,object>)x}).ToList();
    }
    Label LabelAt(Control owner,string text,int x,int y,int w,int h,float size,Color color,bool bold=false) {
      Label l=new Label{Text=text,Location=new Point(x,y),Size=new Size(w,h),Font=new Font("Malgun Gothic",size,bold?FontStyle.Bold:FontStyle.Regular),ForeColor=color};
      owner.Controls.Add(l);return l;
    }
    Button ButtonAt(Control owner,string text,int x,int y,int w,int h) {
      Button b=new Button{Text=text,Location=new Point(x,y),Size=new Size(w,h),FlatStyle=FlatStyle.Flat,
        BackColor=Color.FromArgb(34,44,51),ForeColor=ink,Cursor=Cursors.Hand};
      b.FlatAppearance.BorderColor=Color.FromArgb(60,74,83); owner.Controls.Add(b);return b;
    }
    void Build() {
      TableLayoutPanel frame=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=4,Margin=Padding.Empty,Padding=Padding.Empty};
      frame.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      frame.RowStyles.Add(new RowStyle(SizeType.Absolute,88));
      frame.RowStyles.Add(new RowStyle(SizeType.Absolute,106));
      frame.RowStyles.Add(new RowStyle(SizeType.Percent,100));
      frame.RowStyles.Add(new RowStyle(SizeType.Absolute,96));
      Controls.Add(frame);
      Panel header=new Panel{Dock=DockStyle.Fill,Margin=Padding.Empty,BackColor=Color.FromArgb(21,29,35)};
      frame.Controls.Add(header,0,0); LabelAt(header,"K A R M A",28,12,250,40,23,ink,true);
      LabelAt(header,"v"+ReleaseTrust.Version+"  ·  LAN",281,26,180,26,10,accent,true);
      LabelAt(header,"전장을 고르고, 바로 시작하세요.",30,55,400,24,10,muted);
      accountButton=ButtonAt(header,"로그인 / 계정",0,22,190,38);accountButton.AutoEllipsis=true;
      accountButton.Anchor=AnchorStyles.Top|AnchorStyles.Right;
      refreshStats=ButtonAt(header,"전적 새로고침",0,22,140,38);refreshStats.Anchor=AnchorStyles.Top|AnchorStyles.Right;
      var walletButton=ButtonAt(header,"지갑 · 거래소 ↗",0,63,190,22);walletButton.Anchor=AnchorStyles.Top|AnchorStyles.Right;walletButton.Font=new Font("Malgun Gothic",8);
      walletButton.Click+=(s,e)=>{try{Process.Start(new ProcessStartInfo("https://exchange.ycdc.internal"){UseShellExecute=true});}catch(Exception ex){MessageBox.Show(this,"거래소를 열지 못했습니다.\n"+ex.Message);}};
      header.Resize+=(s,e)=>walletButton.Left=header.ClientSize.Width-walletButton.Width-24;
      header.Resize+=(s,e)=>{accountButton.Left=header.ClientSize.Width-accountButton.Width-24;refreshStats.Left=accountButton.Left-refreshStats.Width-12;};
      accountButton.Left=header.ClientSize.Width-accountButton.Width-24;
      walletButton.Left=accountButton.Left;
      refreshStats.Left=accountButton.Left-refreshStats.Width-12;
      musicButton=ButtonAt(header,"접속 음악 · 1회",refreshStats.Left,63,140,22);musicButton.Font=new Font("Malgun Gothic",8);musicButton.Enabled=false;
      musicButton.Anchor=AnchorStyles.Top|AnchorStyles.Right;header.Resize+=(s,e)=>musicButton.Left=refreshStats.Left;
      var inputButton=ButtonAt(header,"마우스 · 화면",470,63,130,22);inputButton.Font=new Font("Malgun Gothic",8);
      inputButton.Click+=(s,e)=>InputSettings();
      musicButton.Click+=(s,e)=>{menuMusic.Stop();UpdateMusic(false);};
      accountButton.Click+=async(s,e)=>await ManageAccount();
      refreshStats.Click+=async(s,e)=>await SyncMyStats();
      UpdateAccountCaption();
      var stats=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=4,RowCount=1,Margin=Padding.Empty,Padding=new Padding(24,6,24,10),BackColor=Color.FromArgb(21,29,35)};
      foreach(float width in new float[]{25,29,23,23})stats.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,width));
      stats.RowStyles.Add(new RowStyle(SizeType.Percent,100));frame.Controls.Add(stats,0,1);
      var personnel=StatsCard(stats,0,"내 전적",out myRank,out myXp);myName=personnel;
      StatsCard(stats,1,"승 / 패 / 무",out myResults,out myMatches);
      StatsCard(stats,2,"킬 / 데스",out myKd,out myRatio);
      StatsCard(stats,3,"승률",out myWinrate,out mySync);
      UpdateMyStats();
      Panel footer=new Panel{Dock=DockStyle.Fill,Margin=Padding.Empty,BackColor=Color.FromArgb(23,31,37),Padding=new Padding(20)};
      frame.Controls.Add(footer,0,3);
      start=ButtonAt(footer,"게임 시작  →",0,18,200,54);
      start.Anchor=AnchorStyles.Top|AnchorStyles.Right; start.BackColor=accent; start.ForeColor=Color.FromArgb(25,28,26);
      start.Font=new Font("Malgun Gothic",12,FontStyle.Bold); start.FlatAppearance.BorderSize=0; start.Click+=(s,e)=>Launch();
      summary=LabelAt(footer,"",26,17,780,25,11,ink,true);
      status=LabelAt(footer,"",26,49,780,24,9,muted);
      footer.Resize+=(s,e)=>{start.Left=footer.Width-224;summary.Width=footer.Width-285;status.Width=summary.Width;};
      start.Left=ClientSize.Width-224;
      TableLayoutPanel body=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,RowCount=1,Margin=Padding.Empty,Padding=Padding.Empty};
      body.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,234));body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      body.RowStyles.Add(new RowStyle(SizeType.Percent,100));frame.Controls.Add(body,0,2);
      Panel sidebar=new Panel{Dock=DockStyle.Fill,Margin=Padding.Empty,AutoScroll=true,AutoScrollMinSize=new Size(0,792),BackColor=Color.FromArgb(21,28,34)};
      body.Controls.Add(sidebar,0,0);
      LabelAt(sidebar,"플레이 방식",20,22,194,22,10,muted,true);
      modes=new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Location=new Point(20,51),Width=194,FlatStyle=FlatStyle.Flat};
      modes.Items.AddRange(new object[]{"맵 자유 탐험","저격 맵 탐험","사격 연습","AI 1명 대전 (시험판)","서버 방 만들기 (2~8인)","서버 참가 (2~8인)"});
      modes.SelectedIndex=0; sidebar.Controls.Add(modes);
      modes.SelectedIndexChanged+=async(s,e)=>{if(!initializing){if(JoinMode)tab=0;SelectDefaults();RefreshCards();if(JoinMode)await roomDirectory.RefreshRooms();}};
      LabelAt(sidebar,"시대",20,99,194,22,10,muted,true);
      eras=new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Location=new Point(20,128),Width=194,FlatStyle=FlatStyle.Flat};
      eras.Items.AddRange(new object[]{"과거 · 2차 세계대전","미래"});eras.SelectedIndex=0;sidebar.Controls.Add(eras);
      eras.SelectedIndexChanged+=(s,e)=>{age=eras.SelectedIndex;if(!initializing){SelectDefaults();RefreshCards();}};
      LabelAt(sidebar,"선택한 캐릭터",20,183,194,24,10,muted,true);
      portrait=new PictureBox{Location=new Point(20,216),Size=new Size(194,230),BackColor=Color.FromArgb(14,20,24),SizeMode=PictureBoxSizeMode.Zoom};
      sidebar.Controls.Add(portrait);
      characterName=LabelAt(sidebar,"",20,458,194,28,12,ink,true);
      characterCamp=LabelAt(sidebar,"",20,489,194,30,9,muted);
      loadoutButton=ButtonAt(sidebar,"장비 · 계급",20,530,194,38);
      loadoutButton.Click+=(s,e)=>{
        if(refreshingStats||configuringLan||sessionActive||GameRunning())return;
        try{ChooseLoadout();}catch(Exception ex){MessageBox.Show(this,ex.Message,"장비 설정",MessageBoxButtons.OK,MessageBoxIcon.Information);}
      };
      rankInfo=LabelAt(sidebar,"",20,580,194,48,9,accent);
      selection=LabelAt(sidebar,"",20,640,194,132,9,muted);
      contentLayout=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=3,Margin=Padding.Empty,Padding=new Padding(18,0,12,0)};
      contentLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      contentLayout.RowStyles.Add(new RowStyle(SizeType.Absolute,110));
      contentLayout.RowStyles.Add(new RowStyle(SizeType.Percent,100));
      contentLayout.RowStyles.Add(new RowStyle(SizeType.Absolute,0));
      body.Controls.Add(contentLayout,1,0);
      Panel toolbar=new Panel{Dock=DockStyle.Fill,Margin=Padding.Empty};contentLayout.Controls.Add(toolbar,0,0);
      tabs=new Button[3];
      string[] tabnames={"전장 선택","캐릭터 선택","원본 무기"};
      for(int i=0;i<3;i++){int ix=i; tabs[i]=ButtonAt(toolbar,tabnames[i],8+i*140,16,130,36);tabs[i].Click+=(s,e)=>{tab=ix;search.Text="";RefreshCards();};}
      search=new TextBox{Location=new Point(8,67),Width=270,BackColor=Color.FromArgb(34,44,51),ForeColor=ink,BorderStyle=BorderStyle.FixedSingle};
      toolbar.Controls.Add(search);search.TextChanged+=(s,e)=>RefreshCards();
      count=LabelAt(toolbar,"",292,68,440,24,9,muted);
      heading=LabelAt(toolbar,"",465,21,380,28,10,accent,true);heading.Anchor=AnchorStyles.Top|AnchorStyles.Right;
      toolbar.Resize+=(s,e)=>{
        heading.Visible=toolbar.ClientSize.Width>=tabs[2].Right+heading.Width+20;
        heading.Left=Math.Max(tabs[2].Right+12,toolbar.ClientSize.Width-heading.Width-8);
        count.Width=Math.Max(0,toolbar.ClientSize.Width-count.Left-8);
      };
      weaponInfo=new Label{Dock=DockStyle.Fill,Margin=Padding.Empty,ForeColor=muted,Padding=new Padding(10,9,10,0),Visible=false};
      contentLayout.Controls.Add(weaponInfo,0,2);
      grid=new FlowLayoutPanel{Dock=DockStyle.Fill,Margin=Padding.Empty,AutoScroll=true,WrapContents=true,Padding=new Padding(0,4,0,10),BackColor=BackColor};
      contentLayout.Controls.Add(grid,0,1);
      roomDirectory=new RoomDirectory(support,NodePath){Visible=false};
      roomDirectory.SelectionChanged+=(s,e)=>{if(!initializing&&!closingLauncher)UpdateSummary();};
      roomDirectory.JoinRequested+=(s,e)=>Launch();
      contentLayout.Controls.Add(roomDirectory,0,1);
    }
    Label StatsCard(TableLayoutPanel owner,int column,string caption,out Label value,out Label detail){
      var card=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=3,Padding=new Padding(12,6,10,4),Margin=new Padding(4,0,4,0),BackColor=Color.FromArgb(30,40,48)};
      card.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      card.RowStyles.Add(new RowStyle(SizeType.Absolute,22));card.RowStyles.Add(new RowStyle(SizeType.Percent,100));card.RowStyles.Add(new RowStyle(SizeType.Absolute,22));
      var title=new Label{Text=caption,Dock=DockStyle.Fill,AutoEllipsis=true,ForeColor=muted,Margin=Padding.Empty};
      value=new Label{Text="—",Dock=DockStyle.Fill,AutoEllipsis=true,Font=new Font("Malgun Gothic",16,FontStyle.Bold),ForeColor=ink,Margin=Padding.Empty};
      detail=new Label{Dock=DockStyle.Fill,AutoEllipsis=true,Font=new Font("Malgun Gothic",8),ForeColor=accent,Margin=Padding.Empty};
      card.Controls.Add(title,0,0);card.Controls.Add(value,0,1);card.Controls.Add(detail,0,2);owner.Controls.Add(card,column,0);return title;
    }
    void FitWorkingArea() {
      Rectangle area=Screen.FromControl(this).WorkingArea;
      int width=Math.Max(320,area.Width-32),height=Math.Max(320,area.Height-32);
      MinimumSize=new Size(Math.Min(MinimumSize.Width,width),Math.Min(MinimumSize.Height,height));
      Size=new Size(Math.Min(Width,width),Math.Min(Height,height));
      Location=new Point(area.Left+(area.Width-Width)/2,area.Top+(area.Height-Height)/2);
    }
    string CampName(CatalogItem item) {
      if(item==null)return "";
      string name=item.Read("campName");if(name=="")name=item.Read("faction");
      if(name!="")return name;
      return item.Age==0?(item.Number("camp",0)==0?"독일군":"러시아군"):(item.Number("camp",0)==0?"EMPIRE":"R.I.E.");
    }
    int GameMode { get {return modes.SelectedIndex==1?4:modes.SelectedIndex==2?5:1;} }
    bool AiReady { get {object v;return runtime.TryGetValue("aiReady",out v)&&Convert.ToBoolean(v);} }
    bool LanMode { get {return modes.SelectedIndex>=4;} }
    bool JoinMode { get {return modes.SelectedIndex==5;} }
    bool IsAdmin { get {object value;return !profileLoginRequired&&cachedProfile!=null&&cachedProfile.TryGetValue("isAdmin",out value)&&value is bool&&(bool)value;} }
    Dictionary<string,object> MultiplayerMap(CatalogItem item){
      object entries;if(item==null||multiplayerMaps==null||!multiplayerMaps.TryGetValue("maps",out entries)||!(entries is IEnumerable))return null;
      foreach(var entry in (IEnumerable)entries){var data=entry as Dictionary<string,object>;object id;if(data!=null&&data.TryGetValue("id",out id)&&Convert.ToString(id)==item.Id)return data;}return null;
    }
    bool PublicMap(CatalogItem item){
      object entries;
      if(item!=null&&cachedProfile!=null&&cachedProfile.TryGetValue("maps",out entries)&&entries is IEnumerable){
        foreach(var entry in (IEnumerable)entries){var m=entry as Dictionary<string,object>;object id,open;
          if(m!=null&&m.TryGetValue("id",out id)&&Convert.ToString(id)==item.Id&&m.TryGetValue("open",out open)&&open is bool)return (bool)open;}
      }
      return LocalPublicMap(item);
    }
    bool LocalPublicMap(CatalogItem item){var data=MultiplayerMap(item);object ready;return data!=null&&data.TryGetValue("publicReady",out ready)&&ready is bool&&(bool)ready;}
    Dictionary<string,object> CharacterDefinition(CatalogItem item){return item==null?null:JsonDict(JsonDict(loadoutData,"characters"),item.Id);}
    bool CharacterUnlocked(CatalogItem item){return item!=null&&(item.Age!=0?IsAdmin:CharacterDefinition(item)!=null&&profileRankXp>=JsonNumber(CharacterDefinition(item),"unlockXp",0));}
    string CharacterRole(CatalogItem item){var data=CharacterDefinition(item);object value;return data!=null&&data.TryGetValue("roleName",out value)?Convert.ToString(value):CampName(item);}
    string CharacterUnlockText(CatalogItem item){
      var data=CharacterDefinition(item);int required=JsonNumber(data,"unlockXp",0);string rank="훈련병";object entries,value;
      if(loadoutData!=null&&loadoutData.TryGetValue("ranks",out entries)&&entries is IEnumerable)foreach(var entry in (IEnumerable)entries){var r=entry as Dictionary<string,object>;if(JsonNumber(r,"minXp",-1)==required&&r.TryGetValue("name",out value))rank=Convert.ToString(value);}
      return rank+" · XP "+required.ToString("N0")+" 및 기법 숙련";
    }
    int MapIndex(CatalogItem item) {
      if(item==null)return -1;
      if(LanMode){var definition=MultiplayerMap(item);return age==0&&definition!=null&&(IsAdmin||PublicMap(item))?JsonNumber(definition,"mapIndex",-1):-1;}
      var d=item.Dict("launchIndices");object v;
      int index=-1;
      if(d!=null&&d.TryGetValue(age+":"+GameMode,out v))index=Convert.ToInt32(v);
      else if(d!=null&&d.TryGetValue(GameMode.ToString(),out v))index=Convert.ToInt32(v);
      if(!IsAdmin&&!PublicMap(item))return -1;
      if(modes.SelectedIndex==3&&(age!=0||index!=0))return -1;
      if(LanMode&&(age!=0||MultiplayerMap(item)==null))return -1;
      return index;
    }
    void SelectDefaults() {
      if(modes.SelectedIndex>=3){age=0;eras.SelectedIndex=0;}
      eras.Enabled=modes.SelectedIndex<3;
      if(map==null||map.Age!=age||MapIndex(map)<0)map=maps.FirstOrDefault(x=>x.Age==age&&MapIndex(x)>=0);
      if(character==null||character.Age!=age||!CharacterUnlocked(character))character=characters.FirstOrDefault(x=>x.Age==age&&x.Number("characterIndex",-1)>=0&&CharacterUnlocked(x));
    }
    Image Picture(CatalogItem item) {
      if(item==null)return null;string rel=item.Read("thumbnail");
      if(rel=="")return null;string path=Path.GetFullPath(Path.Combine(game,rel.Replace('/',Path.DirectorySeparatorChar)));
      // Catalog entries are local to the game folder or launcher-provided extracted assets.
      if(!path.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))return null;
      Image im;if(images.TryGetValue(path,out im))return im;
      try{using(Image source=Image.FromFile(path)){im=new Bitmap(source);}images[path]=im;return im;}catch{return null;}
    }
    void RefreshCards() {
      if(grid==null||initializing)return;
      bool rooms=JoinMode&&tab==0;
      tabs[0].Text=JoinMode?"개설된 방":"전장 선택";
      string server;int serverPort;RoomServer(out server,out serverPort);
      object account;roomDirectory.SetContext(server,serverPort,cachedProfile!=null&&cachedProfile.TryGetValue("playerId",out account)?Convert.ToString(account):"");
      grid.Visible=!rooms;roomDirectory.Visible=rooms;
      if(rooms){
        roomDirectory.SetFilter(search.Text);
        for(int i=0;i<tabs.Length;i++){tabs[i].BackColor=i==0?accent:Color.FromArgb(34,44,51);tabs[i].ForeColor=i==0?Color.FromArgb(25,28,26):ink;}
        heading.Text="개설된 방";count.Text="방장 · 방 코드 · 맵으로 검색";weaponInfo.Visible=false;contentLayout.RowStyles[2].Height=0;
        UpdateSummary();return;
      }
      grid.SuspendLayout();foreach(Control c in grid.Controls.Cast<Control>().ToArray())c.Dispose();grid.Controls.Clear();
      foreach(Button b in tabs){b.BackColor=Color.FromArgb(34,44,51);b.ForeColor=ink;}
      tabs[tab].BackColor=accent;tabs[tab].ForeColor=Color.FromArgb(25,28,26);
      IEnumerable<CatalogItem> list=tab==0?maps.Where(x=>x.Age==age&&MapIndex(x)>=0):tab==1?characters.Where(x=>x.Age==age&&x.Number("characterIndex",-1)>=0).OrderBy(x=>JsonNumber(CharacterDefinition(x),"unlockXp",0)).ThenBy(x=>CharacterRole(x)):weapons.Where(x=>x.Age==age);
      string q=search.Text.Trim();if(q!="")list=list.Where(x=>(x.Name+" "+x.Id+" "+x.Read("assetId")+(tab==1?" "+CharacterRole(x):"")).IndexOf(q,StringComparison.OrdinalIgnoreCase)>=0);
      List<CatalogItem> shown=list.ToList();
      count.Text=shown.Count+(tab==1?"명 · 이름 / 돌격 / 저격 / 중화기 검색":"개 · 이름으로 검색");
      heading.Text=tab==0?"ORIGINAL BATTLEFIELDS":tab==1?"CHOOSE YOUR CHARACTER":"ORIGINAL ARSENAL";
      weaponInfo.Visible=tab==2;weaponInfo.Text="게임에 포함된 원본 무기입니다. 이 화면에서는 외형과 이름을 확인할 수 있습니다.";
      contentLayout.RowStyles[2].Height=tab==2?Math.Max(42,weaponInfo.Font.Height*3):0;
      foreach(CatalogItem item in shown) {
        bool locked=tab==1&&!CharacterUnlocked(item);
        string sub=tab==0?(PublicMap(item)?"멀티플레이 지원":"관리자 · 미검증 전장"):tab==1?CharacterRole(item)+" · "+(locked?CharacterUnlockText(item):"사용 가능"):item.Read("category");
        Tile tile=new Tile(item,Picture(item),sub,tab==1,locked);
        tile.Selected=item==(tab==0?map:tab==1?character:weapon);
        tile.Pick=t=>{if(tab==1&&!CharacterUnlocked(t.Item)){MessageBox.Show(this,t.Item.Name+" · "+CharacterRole(t.Item)+"\n"+CharacterUnlockText(t.Item)+"부터 선택할 수 있습니다.","캐릭터 해금");return;}if(tab==0)map=t.Item;else if(tab==1)character=t.Item;else weapon=t.Item;
          foreach(Tile card in grid.Controls.OfType<Tile>()){card.Selected=card==t;card.Invalidate();}
          UpdateSummary();SavePreferences();};
        grid.Controls.Add(tile);
      }
      if(shown.Count==0)grid.Controls.Add(new Label{Text="선택한 조건에 해당하는 항목이 없습니다.",AutoSize=true,Margin=new Padding(20),ForeColor=muted});
      grid.ResumeLayout();UpdateSummary();
    }
    void UpdateSummary() {
      portrait.Image=Picture(character);characterName.Text=character!=null?character.Name:"캐릭터를 선택하세요";
      characterCamp.Text=CampName(character)+" · "+CharacterRole(character);
      UpdateRankInfo();
      if(JoinMode){
        var room=roomDirectory.SelectedRoom;
        selection.Text=room==null?"개설된 방에서 참가할 방을 선택하세요.\n전장과 대전 방식은 방장이 정합니다.":"선택한 방  "+room.Code+"\n"+room.HostName+"\n"+room.MapName+"\n"+room.ModeName+"\n"+room.Players+" / "+room.MaxPlayers+"명";
        summary.Text=(room==null?"참가할 방을 선택하세요":room.MapName+" · "+room.HostName+"의 방")+"  /  "+(character!=null?character.Name:"캐릭터 미선택");
        UpdateRunning();return;
      }
      selection.Text=map!=null?"선택한 전장\n"+map.Name+"\n\nW/A/S/D 이동\n마우스 시점 · 왼쪽 클릭 발사\n"+(LanMode?"G 버리기 · E 줍기\nF10 메뉴 · Esc 종료 확인":"F10 일시 정지 · Esc 종료 확인"):"전장을 선택하세요.";
      summary.Text=(map!=null?map.Name:"전장 미선택")+"  /  "+(character!=null?character.Name:"캐릭터 미선택");
      if(tab==2&&weapon!=null)weaponInfo.Text=weapon.Name+"  ·  "+weapon.Read("category")+"  |  원본 게임 내 무기";
      UpdateRunning();
    }
    bool GameRunning() {
      foreach(string name in new[]{"Karma","KarmaOffline","KarmaLocalTest","KarmaPractice","KarmaSession","KarmaAITest","KarmaAIProbe"}) {
        Process[] found=Process.GetProcessesByName(name);
        bool exists=found.Length>0;foreach(Process p in found)p.Dispose();
        if(exists)return true;
      }
      return false;
    }
    bool HelperRunning() {
      try{return sessionHelper!=null&&!sessionHelper.HasExited;}catch{return false;}
    }
    string ReadSessionError() {
      string path=Path.Combine(support,"last-session.log");
      try {
        if(!File.Exists(path)||File.GetLastWriteTimeUtc(path)<sessionStartedUtc)return "";
        string contents;
        using(FileStream stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite))
        using(StreamReader reader=new StreamReader(stream,Encoding.UTF8))contents=reader.ReadToEnd();
        foreach(string line in contents.Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries).Reverse()) {
          Dictionary<string,object> record;
          try{record=json.Deserialize<Dictionary<string,object>>(line);}catch{continue;}
          object value;string kind=record.TryGetValue("kind",out value)?Convert.ToString(value):"";
          if(kind=="launch-error"||kind=="script-error")
            return record.TryGetValue("message",out value)?Convert.ToString(value):"게임 실행 중 오류가 발생했습니다.";
          if(kind=="game-ended"&&record.TryGetValue("crash",out value)&&value!=null&&Convert.ToString(value)!="")
            return "게임이 예기치 않게 종료되었습니다. Launcher\\last-session.log에서 오류 기록을 확인할 수 있습니다.";
        }
      }catch{}
      return "";
    }
    void FinishSession() {
      CloseLobby();
      sessionActive=false;sessionObservedGame=false;
      sessionError=ReadSessionError();
      if(sessionError==""&&sessionHelper!=null)try{
        if(sessionHelper.HasExited&&sessionHelper.ExitCode!=0)
          sessionError="게임 실행 도구가 종료되었습니다. Launcher\\last-session.log에서 오류 기록을 확인해 주세요.";
      }catch{}
      if(sessionHelper!=null){sessionHelper.Dispose();sessionHelper=null;}
      if(!closingLauncher&&sessionError==""&&File.Exists(Path.Combine(support,"lan-return.json"))){
        try {
          var next=ReadSupportJson("lan-return.json");File.Delete(Path.Combine(support,"lan-return.json"));
          if(next==null)throw new InvalidDataException("대기실 복귀 정보를 읽지 못했습니다.");
          string nextPath=Path.Combine(support,"lan-config-"+Guid.NewGuid().ToString("N")+".json");
          lobbyConfig=JsonDict(next,"config");File.WriteAllText(nextPath,json.Serialize(next),Encoding.UTF8);
          sessionStartedUtc=DateTime.UtcNow;sessionError="";
          sessionHelper=Process.Start(new ProcessStartInfo{FileName=NodePath(),Arguments="\""+Path.Combine(support,"lan-runtime.mjs")+"\" \""+nextPath+"\"",WorkingDirectory=game,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});
          if(sessionHelper==null)throw new InvalidOperationException("대기실에 연결하지 못했습니다.");
          lobbyLeaving=false;sessionActive=true;sessionObservedGame=false;sessionLan=true;
          Show();if(WindowState==FormWindowState.Minimized)WindowState=restoreState;UpdateRunning();return;
        }catch(Exception ex){sessionError=ex.Message;}
      }
      RefreshCentralProfile();UpdateRankInfo();
      if(WindowState==FormWindowState.Minimized)WindowState=restoreState;
      Show();Activate();
      if(!closingLauncher)BeginInvoke(new Action(async()=>{await SyncMyStats();if(JoinMode)await roomDirectory.RefreshRooms();}));
      if(sessionError!="")MessageBox.Show(this,sessionError,"게임 실행 오류",MessageBoxButtons.OK,MessageBoxIcon.Information);
    }
    void UpdateMusic(bool running){
      menuMusic.Poll(running);if(musicButton==null)return;
      musicButton.Enabled=menuMusic.Playing;
      musicButton.Text=menuMusic.Playing?"음악 끄기":menuMusic.Failed?"음악 재생 불가":menuMusic.Attempted?"접속 음악 종료":"접속 음악 · 1회";
    }
    void UpdateRunning() {
      if(start==null)return;
      UpdateMusic(GameRunning());
      if(roomDirectory!=null)roomDirectory.Enabled=!configuringLan&&!sessionActive&&!GameRunning();
      if(refreshStats!=null)refreshStats.Enabled=!refreshingStats&&!configuringLan&&!sessionActive&&!GameRunning();
      if(refreshingStats){start.Enabled=false;start.Text="전적 확인 중";accountButton.Enabled=false;loadoutButton.Enabled=false;return;}
      if(configuringLan){
        start.Enabled=false;start.Text="서버 확인 중";loadoutButton.Enabled=false;accountButton.Enabled=false;modes.Enabled=false;eras.Enabled=false;return;
      }
      bool running=GameRunning();
      if(accountButton!=null)accountButton.Enabled=!sessionActive&&!running;
      if(loadoutButton!=null)loadoutButton.Enabled=!sessionActive&&!running&&!configuringLan&&character!=null;
      if(sessionActive) {
        if(running&&!sessionObservedGame){CloseLobby();sessionObservedGame=true;if(sessionLan)WindowState=FormWindowState.Minimized;}
        if(!HelperRunning()||(sessionObservedGame&&!running))FinishSession();
      }
      if(sessionActive&&sessionLan){
        start.Enabled=!sessionObservedGame;start.Text="대기 취소";
        string message="상대를 기다리고 있습니다.";
        var d=ReadSupportJson("lan-status.json");
        if(d!=null){
          object value;if(d.TryGetValue("message",out value))message=Convert.ToString(value);
          if(!lobbyLeaving&&!sessionObservedGame&&d.TryGetValue("phase",out value)&&Convert.ToString(value)=="waiting"){
            if(lobby==null||lobby.IsDisposed){lobby=new LobbyWindow(RequestLanStart,SetLobbyReady,ConfigureLobbyEquipment,()=>{lobby=null;CancelLan();},support,ConfigureLobbyRoom);lobby.UpdateLobby(d);lobby.Show(this);}
            else lobby.UpdateLobby(d);
          }else CloseLobby();
        }
        status.Text=message;summary.Text=lanDetails;modes.Enabled=false;eras.Enabled=false;return;
      }
      modes.Enabled=!sessionActive&&!running;eras.Enabled=modes.Enabled&&modes.SelectedIndex<3;
      bool ai=modes.SelectedIndex==3;
      start.Enabled=!running&&!sessionActive&&(JoinMode?roomDirectory.SelectionReady:map!=null)&&character!=null&&(!ai||AiReady);
      start.Text=running?"게임 실행 중":sessionActive?"게임 시작 중":ai&&!AiReady?"AI 기능 준비 중":LanMode?(modes.SelectedIndex==4?"서버 방 만들기 →":"선택한 방 참가 →"):"게임 시작  →";
      status.Text=running?"F10 메뉴 · Esc 종료 확인 · 종료하면 선택 화면으로 돌아옵니다.":sessionActive?"게임을 시작하고 있습니다…":sessionError!=""?"실행 오류: "+sessionError:LanMode?"1:1 / 4:4 팀전 / 8인 개인전 · "+(modes.SelectedIndex==5?"개설된 방을 선택해 참가":map!=null?map.Name:""):ai&&!AiReady?"AI 대전은 아직 사용할 수 없습니다.":ai?"AI 1명 · 사망 후 재등장 · Mass of Winter 시험판":"F10 일시 정지 · Esc 종료 확인";
    }
    void CloseLobby(){if(lobby!=null){var old=lobby;lobby=null;old.Dismiss();}}
    void RequestLanStart(string roomId){
      if(String.IsNullOrEmpty(roomId))return;
      string command=Path.Combine(support,"lan-start.json"),temp=command+".tmp";
      File.WriteAllText(temp,json.Serialize(new Dictionary<string,object>{{"roomId",roomId}}),Encoding.UTF8);
      if(File.Exists(command))File.Delete(command);File.Move(temp,command);
    }
    async Task UpdateLobbyState(string roomId,Dictionary<string,object> update){
      if(!sessionActive||sessionObservedGame||GameRunning())throw new InvalidOperationException("대기실에서만 준비와 장비를 바꿀 수 있습니다.");
      string requestId=Guid.NewGuid().ToString("N"),command=Path.Combine(support,"lan-lobby-command.json"),temp=command+".tmp";
      update["requestId"]=requestId;update["roomId"]=roomId;
      File.WriteAllText(temp,json.Serialize(update),Encoding.UTF8);
      if(File.Exists(command))File.Delete(command);File.Move(temp,command);
      DateTime until=DateTime.UtcNow.AddSeconds(10);
      while(DateTime.UtcNow<until){
        await Task.Delay(100);
        if(closingLauncher||!sessionActive||sessionObservedGame||GameRunning())throw new InvalidOperationException("대전이 시작됐거나 대기실 연결이 종료되었습니다.");
        var result=ReadSupportJson("lan-lobby-result.json");object value;
        if(result==null||!result.TryGetValue("requestId",out value)||Convert.ToString(value)!=requestId)continue;
        if(!result.TryGetValue("ok",out value)||!(value is bool)||!(bool)value)
          throw new InvalidOperationException(result.TryGetValue("message",out value)?Convert.ToString(value):"대기실 변경 요청이 거절되었습니다.");
        var accepted=JsonDict(result,"config");if(accepted!=null)lobbyConfig=accepted;
        return;
      }
      throw new IOException("서버가 준비 상태 변경에 응답하지 않습니다. 잠시 후 다시 시도하세요.");
    }
    Task SetLobbyReady(string roomId,bool ready){return UpdateLobbyState(roomId,new Dictionary<string,object>{{"ready",ready}});}
    async Task ConfigureLobbyEquipment(string roomId){
      // Wait for the server acknowledgement before opening a modal dialog;
      // this prevents the host from starting while this player is editing.
      await SetLobbyReady(roomId,false);
      var selected=ChooseLoadout();if(selected==null)return;
      var next=new Dictionary<string,object>(lobbyConfig);
      next["inventory"]=selected["inventory"];next["selectedWeapon"]=selected["selectedWeapon"];
      await UpdateLobbyState(roomId,new Dictionary<string,object>{{"config",next}});
    }
    async Task ConfigureLobbyRoom(string roomId,Dictionary<string,object> state){
      await SetLobbyReady(roomId,false);
      using(var dialog=new RoomSettingsDialog(state)){
        if(dialog.ShowDialog(lobby)==DialogResult.OK)await UpdateLobbyState(roomId,new Dictionary<string,object>{{"roomSettings",dialog.Settings},{"roomRevision",JsonNumber(state,"roomRevision",0)}});
      }
    }
    Dictionary<string,object> ReadSupportJson(string filename) {
      try{
        using(var stream=new FileStream(Path.Combine(support,filename),FileMode.Open,FileAccess.Read,FileShare.ReadWrite))
        using(var reader=new StreamReader(stream,Encoding.UTF8))
          return json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
      }catch{return null;}
    }
    static Dictionary<string,object> JsonDict(Dictionary<string,object> d,string key) {
      object value;return d!=null&&d.TryGetValue(key,out value)?value as Dictionary<string,object>:null;
    }
    static int JsonNumber(Dictionary<string,object> d,string key,int fallback) {
      object value;int n;
      return d!=null&&d.TryGetValue(key,out value)&&Int32.TryParse(Convert.ToString(value),out n)?n:fallback;
    }
    void RefreshCentralProfile() {
      var cached=ReadSupportJson("central-profile.json");
      cachedProfile=profileLoginRequired?null:JsonDict(cached,"profile")??cached;
      profileXp=Math.Max(0,JsonNumber(cachedProfile,"xp",0));
      profileRankXp=Math.Max(0,JsonNumber(cachedProfile,"rankXp",profileXp));
      UpdateAccountCaption();
      UpdateMyStats();
      if(!initializing&&maps!=null&&modes!=null){SelectDefaults();RefreshCards();}
    }
    void UpdateMyStats(){
      if(myName==null)return;
      object value;bool known=cachedProfile!=null&&cachedProfile.TryGetValue("playerId",out value)&&!String.IsNullOrEmpty(Convert.ToString(value));
      if(!known){
        myName.Text="내 전적";myRank.Text="로그인 필요";myXp.Text="오른쪽 위 로그인 / 계정";
        myResults.Text="— / — / —";myMatches.Text="누적 전적";myKd.Text="— / —";myRatio.Text="K/D —";myWinrate.Text="—";mySync.Text=profileSyncMessage;return;
      }
      string name=cachedProfile.TryGetValue("name",out value)?Convert.ToString(value):"플레이어";
      string rank="훈련병";int threshold=-1;object rankValues;
      if(loadoutData!=null&&loadoutData.TryGetValue("ranks",out rankValues)&&rankValues is IEnumerable)foreach(var entry in (IEnumerable)rankValues){
        var item=entry as Dictionary<string,object>;int min=JsonNumber(item,"minXp",-1);
        if(min>=0&&min<=profileRankXp&&min>threshold){threshold=min;if(item.TryGetValue("name",out value))rank=Convert.ToString(value);}
      }
      int wins=Math.Max(0,JsonNumber(cachedProfile,"wins",0)),losses=Math.Max(0,JsonNumber(cachedProfile,"losses",0)),draws=Math.Max(0,JsonNumber(cachedProfile,"draws",0));
      int kills=Math.Max(0,JsonNumber(cachedProfile,"kills",0)),deaths=Math.Max(0,JsonNumber(cachedProfile,"deaths",0));
      long matches=(long)wins+losses+draws;
      myName.Text="내 전적 · "+name;myRank.Text=rank;myXp.Text="XP "+profileXp.ToString("N0");
      var coins=JsonDict(cachedProfile,"coins");object available;
      if(coins!=null){bool current=coins.TryGetValue("available",out available)&&available!=null;
        myXp.Text+="  ·  "+(current?(Convert.ToDecimal(available)/100m).ToString("N2")+" KARMA":"코인 조회 대기");}
      myResults.Text=wins.ToString("N0")+" / "+losses.ToString("N0")+" / "+draws.ToString("N0");
      myMatches.Text="총 "+matches.ToString("N0")+"경기 · 종료된 경기 기준";
      myKd.Text=kills.ToString("N0")+" / "+deaths.ToString("N0");
      myRatio.Text="K/D "+(deaths>0?((double)kills/deaths).ToString("0.00"):kills>0?"무사망":"0.00");
      myWinrate.Text=(matches>0?100.0*wins/matches:0).ToString("0.0")+"%";mySync.Text=profileSyncMessage;
    }
    async Task SyncMyStats(){
      if(closingLauncher||IsDisposed||refreshingStats||configuringLan||sessionActive||GameRunning())return;
      refreshingStats=true;profileSyncMessage="서버 기록 확인 중…";UpdateMyStats();UpdateRunning();
      try{
        var selected=ReadSupportJson("server-selection.json");object stored;IPAddress address;
        string host=selected!=null&&selected.TryGetValue("host",out stored)?Convert.ToString(stored):"192.168.12.100";
        if(!IPAddress.TryParse(host,out address)||address.AddressFamily!=AddressFamily.InterNetwork||address.Equals(IPAddress.Any)||address.Equals(IPAddress.Broadcast))host="192.168.12.100";
        int port=JsonNumber(selected,"port",29020);if(port<1||port>65534)port=29020;
        await RefreshServerProfile(host,port,true);
      }catch(AccountRequiredException){cachedProfile=null;profileXp=0;profileRankXp=0;profileSyncMessage="로그인하면 전적이 표시됩니다.";}
      catch{profileSyncMessage=cachedProfile==null?"서버 연결 확인 필요":"저장된 기록 · 서버 연결 확인 필요";}
      finally{refreshingStats=false;if(!closingLauncher&&!IsDisposed){UpdateAccountCaption();UpdateRankInfo();UpdateMyStats();UpdateRunning();}}
    }
    void UpdateAccountCaption() {
      if(accountButton==null)return;
      object name;
      accountButton.Text=cachedProfile!=null&&cachedProfile.TryGetValue("email",out name)&&
        !String.IsNullOrEmpty(Convert.ToString(name))?
        "이름 수정: "+(cachedProfile.TryGetValue("name",out name)?Convert.ToString(name):"로그인됨"):"로그인 / 계정";
    }
    void UpdateRankInfo() {
      if(rankInfo==null)return;
      if(character==null){rankInfo.Text="캐릭터를 선택하세요.";return;}
      if(character.Age!=0){rankInfo.Text="중앙 서버 대전은 과거 시대를 지원합니다.";return;}
      string rank="훈련병";int bonus=0,bestThreshold=-1;
      object rankValues;
      if(loadoutData!=null&&loadoutData.TryGetValue("ranks",out rankValues)&&rankValues is IEnumerable)
        foreach(var entry in ((IEnumerable)rankValues).Cast<object>()){
          var item=entry as Dictionary<string,object>;
          int threshold=JsonNumber(item,"minXp",-1);
          if(threshold>=0&&threshold<=profileRankXp&&threshold>=bestThreshold){
            object name;rank=item.TryGetValue("name",out name)?Convert.ToString(name):"훈련병";
            bonus=Math.Max(0,JsonNumber(item,"budgetBonus",0));bestThreshold=threshold;
          }
        }
      var definitions=JsonDict(loadoutData,"characters");
      var definition=JsonDict(definitions,character.Id);
      int capacity=JsonNumber(definition,"inventoryCapacity",0);
      rankInfo.Text="대전 "+rank+" · XP "+profileXp.ToString("N0")+
        (capacity>0?"\n장비 예산 "+(capacity+bonus).ToString("N0")+"점":"");
    }
    Dictionary<string,object> ChooseLoadout(bool show=true) {
      if(character==null)return null;
      RefreshCentralProfile();UpdateRankInfo();
      if(!CharacterUnlocked(character))throw new InvalidOperationException("이 캐릭터는 "+CharacterUnlockText(character)+"부터 선택할 수 있습니다.");
      var all=ReadSupportJson("loadout-selection.json")??new Dictionary<string,object>();
      var byCharacter=JsonDict(all,"characters")??new Dictionary<string,object>();
      var saved=JsonDict(byCharacter,character.Id);
      using(var dialog=new LoadoutDialog(game,support,character,profileXp,saved,profileRankXp)){
        if(show&&dialog.ShowDialog(lobby!=null&&!lobby.IsDisposed?(IWin32Window)lobby:this)!=DialogResult.OK)return null;
        if(!dialog.SelectionValid)throw new InvalidOperationException("출전 장비를 확인할 수 없습니다. 장비 설정에서 병과와 예산을 확인해 주세요.");
        var selected=new Dictionary<string,object>{{"inventory",dialog.Inventory.ToArray()},
          {"selectedWeapon",dialog.SelectedWeapon}};
        byCharacter[character.Id]=selected;all["schemaVersion"]=1;all["characters"]=byCharacter;
        File.WriteAllText(Path.Combine(support,"loadout-selection.json"),json.Serialize(all),Encoding.UTF8);
        UpdateRankInfo();return selected;
      }
    }
    sealed class AccountRequiredException : InvalidOperationException {
      public AccountRequiredException(string message):base(message){}
    }
    async Task RefreshServerProfile(string host,int port,bool quiet=false) {
      string cli=Path.Combine(support,"central-profile.mjs");
      if(!File.Exists(cli))throw new FileNotFoundException("서버 계급 확인 도구가 없습니다.",cli);
      string node=NodePath();
      DateTime requested=DateTime.UtcNow;
      if(!quiet){status.Text="중앙 서버에서 계급과 장비 예산을 확인하고 있습니다…";UseWaitCursor=true;grid.Enabled=false;}
      string failure="";
      try{
        failure=await Task.Run(()=>{
          var output=new StringBuilder();object outputLock=new object();
          using(var process=new Process()){
            process.StartInfo=new ProcessStartInfo{FileName=node,
              Arguments="\""+cli+"\" "+host+" "+port,
              WorkingDirectory=game,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,
              RedirectStandardOutput=true,RedirectStandardError=true,
              StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
            DataReceivedEventHandler capture=(s,e)=>{
              if(String.IsNullOrEmpty(e.Data))return;
              lock(outputLock){
                if(output.Length<3000)output.AppendLine(e.Data.Substring(0,Math.Min(e.Data.Length,600)));
              }
            };
            process.OutputDataReceived+=capture;process.ErrorDataReceived+=capture;
            if(!process.Start())return "계급 확인 도구를 시작할 수 없습니다.";
            process.BeginOutputReadLine();process.BeginErrorReadLine();
            var elapsed=Stopwatch.StartNew();
            while(!process.WaitForExit(100)){
              if(closingLauncher||elapsed.ElapsedMilliseconds>=12000){
                try{process.Kill();process.WaitForExit(1000);}catch{}
                return closingLauncher?"창을 닫아 계급 확인을 취소했습니다.":"서버 응답 시간이 초과되었습니다. 서버 주소와 연결 상태를 확인해 주세요.";
              }
            }
            process.WaitForExit();
            if(process.ExitCode==0)return "";
            lock(outputLock){
              string detail=output.ToString().Trim();
              return detail==""?"서버 계급을 확인하지 못했습니다. 서버 주소와 연결 상태를 확인해 주세요.":
                "서버 계급을 확인하지 못했습니다.\n"+detail;
            }
          }
        });
      } finally{
        if(!quiet&&!IsDisposed&&!closingLauncher){UseWaitCursor=false;grid.Enabled=true;}
      }
      if(closingLauncher||IsDisposed)return;
      if(failure!=""){
        if(failure.IndexOf("AUTH_REQUIRED",StringComparison.Ordinal)>=0||
          failure.IndexOf("AUTH_EXPIRED",StringComparison.Ordinal)>=0||
          failure.IndexOf("SESSION_EXPIRED",StringComparison.Ordinal)>=0||
          failure.IndexOf("TOKEN_EXPIRED",StringComparison.Ordinal)>=0){
          profileLoginRequired=true;profileSyncMessage="로그인하면 전적이 표시됩니다.";
          RefreshCentralProfile();UpdateRankInfo();
          throw new AccountRequiredException("중앙 서버에 로그인해 주세요.");
        }
        throw new InvalidOperationException(failure);
      }
      string cache=Path.Combine(support,"central-profile.json");
      var cached=ReadSupportJson("central-profile.json");
      var profile=JsonDict(cached,"profile")??cached;
      if(JsonNumber(profile,"xp",-1)<0||!File.Exists(cache)||File.GetLastWriteTimeUtc(cache)<requested.AddSeconds(-1))
        throw new InvalidDataException("서버의 최신 계급 기록을 받지 못했습니다. 다시 연결해 주세요.");
      profileLoginRequired=false;profileSyncMessage=DateTime.Now.ToString("HH:mm")+" 서버 기록 갱신";
      RefreshCentralProfile();UpdateRankInfo();
      menuMusic.Connected(GameRunning());UpdateMusic(false);
    }
    async Task<bool> EnsureCentralAccount(string host,int port) {
      bool loginRequired=false;
      try{await RefreshServerProfile(host,port);}catch(AccountRequiredException){loginRequired=true;}
      if(loginRequired){
        using(var account=new AuthDialog(root,support,NodePath(),host,port)){
          if(account.ShowDialog(this)!=DialogResult.OK||!account.Authenticated)return false;
        }
        await RefreshServerProfile(host,port);
      }
      return !closingLauncher&&!IsDisposed;
    }
    async Task ManageAccount() {
      if(refreshingStats||configuringLan||sessionActive||GameRunning())return;
      configuringLan=true;UpdateRunning();
      try{
        var selected=ReadSupportJson("server-selection.json");
        object stored;IPAddress address;
        string host=selected!=null&&selected.TryGetValue("host",out stored)?Convert.ToString(stored):"192.168.12.100";
        if(!IPAddress.TryParse(host,out address)||address.AddressFamily!=AddressFamily.InterNetwork||
          address.Equals(IPAddress.Any)||address.Equals(IPAddress.Broadcast))host="192.168.12.100";
        else host=address.ToString();
        int port=JsonNumber(selected,"port",29020);if(port<1||port>65534)port=29020;
        bool loginRequired=false;
        try{await RefreshServerProfile(host,port);}catch(AccountRequiredException){loginRequired=true;}
        if(closingLauncher||IsDisposed)return;
        using(var account=new AuthDialog(root,support,NodePath(),host,port)){
          if(!loginRequired)account.ShowAccount(cachedProfile);
          if(account.ShowDialog(this)==DialogResult.OK){
            if(account.Authenticated)await RefreshServerProfile(host,port);
            else {menuMusic.Stop();UpdateMusic(false);profileLoginRequired=true;profileSyncMessage="로그인하면 전적이 표시됩니다.";RefreshCentralProfile();UpdateRankInfo();}
          }
        }
      }catch(Exception ex){if(!closingLauncher&&!IsDisposed)
        MessageBox.Show(this,ex.Message,"중앙 서버 계정",MessageBoxButtons.OK,MessageBoxIcon.Information);
      }finally{configuringLan=false;if(!closingLauncher&&!IsDisposed)UpdateRunning();}
    }
    string NodePath() {
      string node=Path.Combine(root,"Runtime","node.exe");
      if(!File.Exists(node))node=Path.GetFullPath(Path.Combine(root,Convert.ToString(runtime["nodePath"])));
      if(!File.Exists(node))throw new FileNotFoundException("실행 도구를 찾을 수 없습니다.",node);
      return node;
    }
    void CancelLan(){lobbyLeaving=true;CloseLobby();try{File.WriteAllText(Path.Combine(support,"lan-cancel.json"),"{}",Encoding.UTF8);}catch{}}
    void InputSettings(){InputSettingsDialog.Show(this);}
    void RoomServer(out string host,out int port){
      var selected=ReadSupportJson("server-selection.json");object value;IPAddress address;
      host=selected!=null&&selected.TryGetValue("host",out value)?Convert.ToString(value):"192.168.12.100";
      if(!IPAddress.TryParse(host,out address)||address.AddressFamily!=AddressFamily.InterNetwork||address.Equals(IPAddress.Any)||address.Equals(IPAddress.Broadcast))host="192.168.12.100";
      else host=address.ToString();
      port=JsonNumber(selected,"port",29020);if(port<1||port>65534)port=29020;
    }
    async Task LaunchLan(){
      bool hosting=!JoinMode,lateJoin=false;string host,code,matchMode,roomId="",roomName="";int port,maxPlayers,mapIndex,killLimit=10,roundWinLimit=5,timeLimitSeconds=600;
      if(hosting){
        using(var dialog=new LanSetup(true,support,JsonNumber(MultiplayerMap(map),"maxPlayers",8))){
          if(dialog.ShowDialog(this)!=DialogResult.OK)return;
          host=dialog.Host;port=dialog.Port;code=dialog.Code;maxPlayers=dialog.MaxPlayers;matchMode=dialog.MatchMode;roomName=dialog.RoomName;
          killLimit=dialog.KillLimit;roundWinLimit=dialog.RoundWinLimit;timeLimitSeconds=dialog.TimeLimitSeconds;
        }
        mapIndex=MapIndex(map);
      }else{
        var selected=roomDirectory.SelectedRoom;
        if(selected==null)throw new InvalidOperationException("개설된 방 목록에서 참가할 방을 선택하세요.");
        string id=selected.RoomId;
        await roomDirectory.RefreshRooms();if(closingLauncher||IsDisposed)return;
        selected=roomDirectory.SelectedRoom;
        if(selected==null||selected.RoomId!=id)throw new InvalidOperationException("선택한 방이 닫혔습니다. 다른 방을 선택하세요.");
        if(!selected.CanJoin)throw new InvalidOperationException("방 상태가 변경되어 참가할 수 없습니다. 다른 방을 선택하세요.");
        host=roomDirectory.Host;port=roomDirectory.Port;code=selected.Code;maxPlayers=selected.MaxPlayers;matchMode=selected.Mode;
        mapIndex=selected.Map;roomId=selected.RoomId;
        lateJoin=selected.State=="playing"&&selected.Mode=="dm";
      }
      if(!await EnsureCentralAccount(host,port))return;
      if(mapIndex<0)throw new InvalidOperationException("멀티플레이 지원 전장을 선택하세요.");
      Dictionary<string,object> loadout;
      // Waiting rooms reserve this player's unready seat immediately. Active
      // deathmatches retain their existing equipment-confirmed late join.
      // Restore and validate saved equipment without a modal before reserving
      // the unready seat; only active DM joins configure before connecting.
      loadout=ChooseLoadout(lateJoin);if(loadout==null)return;
      string configPath=Path.Combine(support,"lan-config-"+Guid.NewGuid().ToString("N")+".json");
      var options=new Dictionary<string,object>{
        {"transport","central"},{"role",hosting?"host":"join"},{"host",host},{"port",port},{"code",code},{"maxPlayers",maxPlayers},{"matchMode",matchMode},
        {"config",new Dictionary<string,object>{
          {"map",mapIndex},{"age",0},
          {"character",new Dictionary<string,object>{{"id",character.Id},{"index",character.Number("characterIndex",0)},
            {"camp",character.Number("camp",0)},{"name",character.Read("enName")},
            {"model",Path.GetFileName(character.Read("model").Replace('/',Path.DirectorySeparatorChar)).ToLowerInvariant()}}}}}};
      lobbyConfig=(Dictionary<string,object>)options["config"];
      if(loadout!=null){lobbyConfig["inventory"]=loadout["inventory"];lobbyConfig["selectedWeapon"]=loadout["selectedWeapon"];}
      if(hosting){options["roomName"]=roomName;options["killLimit"]=killLimit;options["roundWinLimit"]=roundWinLimit;options["timeLimitSeconds"]=timeLimitSeconds;}
      if(!hosting)options["roomId"]=roomId;
      File.WriteAllText(configPath,json.Serialize(options),Encoding.UTF8);
      try{File.Delete(Path.Combine(support,"lan-cancel.json"));File.Delete(Path.Combine(support,"lan-status.json"));}catch{}
      try{File.Delete(Path.Combine(support,"lan-return.json"));}catch{}
      SavePreferences();sessionStartedUtc=DateTime.UtcNow;sessionError="";
      sessionHelper=Process.Start(new ProcessStartInfo{FileName=NodePath(),
        Arguments="\""+Path.Combine(support,"lan-runtime.mjs")+"\" \""+configPath+"\"",
        WorkingDirectory=game,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});
      if(sessionHelper==null)throw new InvalidOperationException("중앙 서버 대전 도구를 시작할 수 없습니다.");
      lobbyLeaving=false;sessionActive=true;sessionObservedGame=false;sessionLan=true;
      lanDetails="서버 "+host+":"+port+"  ·  "+(hosting?"방 만들기":"참가")+"  ·  코드 "+code;
      restoreState=WindowState==FormWindowState.Maximized?FormWindowState.Maximized:FormWindowState.Normal;
      UpdateRunning();
    }
    void WriteInt(byte[] bytes,int offset,int value) {
      if(offset<0||offset+4>bytes.Length)throw new InvalidDataException("실행 설정 위치가 올바르지 않습니다.");
      Buffer.BlockCopy(BitConverter.GetBytes(value),0,bytes,offset,4);
    }
    async void Launch() {
      if(refreshingStats||configuringLan)return;
      if(sessionActive&&sessionLan&&!sessionObservedGame){CancelLan();return;}
      if(GameRunning()||sessionActive){UpdateRunning();return;}
      try {
        if(LanMode){configuringLan=true;UpdateRunning();try{await LaunchLan();}finally{configuringLan=false;if(!closingLauncher&&!IsDisposed)UpdateRunning();}return;}
        byte[] bytes=File.ReadAllBytes(Path.Combine(support,"session-template.bin"));
        using(SHA256 sha=SHA256.Create()){
          string digest=BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();
          if(digest!=Convert.ToString(runtime["sha256"]))throw new InvalidDataException("실행 파일 템플릿을 확인할 수 없습니다.");
        }
        var offsets=(Dictionary<string,object>)runtime["offsets"];
        var values=new Dictionary<string,int>{{"local",1},{"mode",GameMode},{"matchType",1},{"age",age},{"map",MapIndex(map)},
          {"character",character.Number("characterIndex",0)},{"camp",character.Number("camp",0)}};
        if(values["map"]<0)throw new InvalidOperationException("이 모드에서 선택한 맵을 실행할 수 없습니다.");
        foreach(var kv in values)WriteInt(bytes,Convert.ToInt32(offsets[kv.Key]),kv.Value);
        string exe=Path.Combine(game,"KarmaSession.exe");File.WriteAllBytes(exe,bytes);
        SavePreferences();
        string node=NodePath();sessionLan=false;
        menuMusic.Stop();UpdateMusic(false);
        sessionStartedUtc=DateTime.UtcNow;sessionError="";
        sessionHelper=Process.Start(new ProcessStartInfo{FileName=node,Arguments="\""+Path.Combine(support,"runtime.mjs")+"\" \""+exe+"\""+(modes.SelectedIndex==3?" --ai":""),
          WorkingDirectory=game,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});
        if(sessionHelper==null)throw new InvalidOperationException("게임 실행 도구를 시작할 수 없습니다.");
        sessionActive=true;sessionObservedGame=false;
        restoreState=WindowState==FormWindowState.Maximized?FormWindowState.Maximized:FormWindowState.Normal;
        status.Text="게임을 시작하고 있습니다…";start.Enabled=false;WindowState=FormWindowState.Minimized;
      } catch(Exception ex) {if(!closingLauncher&&!IsDisposed){if(JoinMode)BeginInvoke(new Action(async()=>await roomDirectory.RefreshRooms()));MessageBox.Show(this,ex.Message,"실행할 수 없습니다",MessageBoxButtons.OK,MessageBoxIcon.Information);}}
    }
    void SavePreferences() {
      try {var d=new Dictionary<string,object>{{"age",age},{"mode",modes.SelectedIndex},{"map",map==null?"":map.Id},{"character",character==null?"":character.Id}};
        File.WriteAllText(Path.Combine(support,"selection.json"),json.Serialize(d),Encoding.UTF8);}catch{}
    }
    void LoadPreferences() {
      try {var d=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(support,"selection.json")));
        age=Convert.ToInt32(d["age"]);eras.SelectedIndex=Math.Max(0,Math.Min(1,age));
        modes.SelectedIndex=Math.Max(0,Math.Min(5,Convert.ToInt32(d["mode"])));
        map=maps.FirstOrDefault(x=>x.Id==Convert.ToString(d["map"]));character=characters.FirstOrDefault(x=>x.Id==Convert.ToString(d["character"]));
      }catch{}
    }
    [STAThread] public static void Main() {
      if(Environment.GetCommandLineArgs().Contains("--coin-hud"))CoinHud.InitializeDpi();
      Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
      try{
        string[] args=Environment.GetCommandLineArgs();
        if(args.Length==4&&args[1]=="--coin-hud")Application.Run(new CoinHud(Int32.Parse(args[2]),Int32.Parse(args[3])));
        else if(args.Length==5&&args[1]=="--results")Application.Run(new ResultsWindow(args[2],args[3],Int32.Parse(args[4])));
        else if(args.Length==6&&args[1]=="--chat")Application.Run(new ChatWindow(args[2],args[3],Int32.Parse(args[4]),args[5]));
        else if(args.Length>=5&&args.Length<=7&&args[1]=="--pause")Application.Run(new PauseWindow(args[2],args[3],Int32.Parse(args[4]),args.Contains("--lan"),args.Contains("--confirm-exit")));
        else {
          string installRoot=AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
          using(var lease=ReleaseUpdate.Acquire(installRoot)){
            if(lease==null){MessageBox.Show("카르마가 이미 실행 중입니다. 열려 있는 창을 확인해 주세요.","카르마");return;}
            try{using(var update=new UpdateWindow(installRoot)){Application.Run(update);if(update.Ready)Application.Run(new Launcher());}}
            finally{lease.ReleaseMutex();}
          }
        }
      }catch(Exception e){MessageBox.Show(e.Message,"카르마 로컬 실행",MessageBoxButtons.OK,MessageBoxIcon.Error);}
    }
  }
}
