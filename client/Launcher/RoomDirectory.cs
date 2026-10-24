using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Collections;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace KarmaLocal {
  public sealed class RoomEntry {
    public string RoomId,Code,RoomName,HostName,MapName,Mode,State,Build;
    public int Map,Players,MaxPlayers,GameFee,KillLimit,RoundWinLimit,TimeLimitSeconds;
    public string Limits {get{return (Mode=="tdm"?RoundWinLimit+"승":KillLimit+"킬")+" / "+(TimeLimitSeconds/60)+"분";}}
    public bool Joinable;
    public bool CanJoin { get { return Joinable&&Build==ReleaseTrust.GameBuild; } }
    public string ModeName { get { return Mode=="dm"?"개인 데스매치":Mode=="tdm"?"팀 전멸전":"1:1 대전"; } }
    public string StateName { get {
      if(Build!=ReleaseTrust.GameBuild)return "버전 다름";
      if(State=="starting")return "시작 준비 중";
      if(Players>=MaxPlayers||State=="full")return "정원 마감";
      if(State=="playing")return CanJoin?"진행 중 · 참가 가능":"진행 중";
      return CanJoin?"대기 중":"참가 불가";
    } }
    static string Text(Dictionary<string,object> d,string k){object v;return d.TryGetValue(k,out v)?Convert.ToString(v):"";}
    static int Number(Dictionary<string,object> d,string k){int v;return Int32.TryParse(Text(d,k),out v)?v:-1;}
    public static RoomEntry Parse(Dictionary<string,object> d){
      if(d==null)throw new InvalidDataException("잘못된 방 정보입니다.");
      object flag;
      var room=new RoomEntry{RoomId=Text(d,"roomId"),Code=Text(d,"code"),RoomName=Text(d,"roomName"),HostName=Text(d,"hostName"),
        MapName=Text(d,"mapName"),Mode=Text(d,"mode"),State=Text(d,"state"),Build=Text(d,"build"),
        Map=Number(d,"map"),Players=Number(d,"players"),MaxPlayers=Number(d,"maxPlayers"),GameFee=Number(d,"gameFee"),
        KillLimit=Number(d,"killLimit"),RoundWinLimit=Number(d,"roundWinLimit"),TimeLimitSeconds=Number(d,"timeLimitSeconds"),
        Joinable=d.TryGetValue("joinable",out flag)&&flag is bool&&(bool)flag};
      if(room.RoomId.Length<1||room.RoomId.Length>96||room.Code.Length!=6||room.Code.Any(c=>c<'0'||c>'9')||
        room.Map<0||room.Map>255||room.Players<1||room.MaxPlayers<2||room.MaxPlayers>8||room.Players>room.MaxPlayers||
        !new[]{"dm","tdm","duel"}.Contains(room.Mode)||room.RoomName.Length>64||room.HostName.Length>128||room.MapName.Length>128)
        throw new InvalidDataException("서버에서 잘못된 방 정보를 받았습니다.");
      return room;
    }
  }

  public sealed class RoomDirectory : UserControl {
    readonly Func<string> nodePath;
    readonly string support;
    readonly ListView list;
    readonly Label serverLabel,info;
    readonly Button refresh;
    readonly System.Windows.Forms.Timer timer;
    List<RoomEntry> entries=new List<RoomEntry>();
    Task refreshTask;
    string host="192.168.12.100",context="",filter="",message="방 목록을 불러오는 중…";
    int port=29020,revision;
    bool rendering;
    volatile bool closing;
    DateTime fetched=DateTime.MinValue;
    public event EventHandler SelectionChanged;
    public event EventHandler JoinRequested;
    public string Host {get{return host;}}
    public int Port {get{return port;}}
    public RoomEntry SelectedRoom {get{return list.SelectedItems.Count==1?list.SelectedItems[0].Tag as RoomEntry:null;}}
    public bool SelectionReady {get{return SelectedRoom!=null&&SelectedRoom.CanJoin&&DateTime.UtcNow-fetched<TimeSpan.FromSeconds(15);}}
    public RoomDirectory(string directory,Func<string> runtime){
      support=directory;nodePath=runtime;Dock=DockStyle.Fill;Margin=Padding.Empty;
      BackColor=Color.FromArgb(16,22,27);ForeColor=Color.FromArgb(235,238,235);
      var layout=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=3,Margin=Padding.Empty};
      layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      layout.RowStyles.Add(new RowStyle(SizeType.Absolute,46));layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,76));Controls.Add(layout);
      var top=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2};top.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));top.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,116));layout.Controls.Add(top,0,0);
      serverLabel=new Label{Dock=DockStyle.Fill,Text="개설된 방",AutoEllipsis=true,Padding=new Padding(8,10,0,0)};
      refresh=new Button{Text="새로고침",Dock=DockStyle.Fill,FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(34,44,51)};
      top.Controls.Add(serverLabel,0,0);top.Controls.Add(refresh,1,0);
      list=new ListView{Dock=DockStyle.Fill,View=View.Details,FullRowSelect=true,MultiSelect=false,HideSelection=false,
        BackColor=Color.FromArgb(25,35,43),ForeColor=ForeColor,BorderStyle=BorderStyle.FixedSingle,HeaderStyle=ColumnHeaderStyle.Nonclickable};
      foreach(var title in new[]{"방 이름","방장","전장","대전 방식","인원","상태","방 코드"})list.Columns.Add(title);
      list.Columns[0].Width=180;list.Columns[1].Width=110;list.Columns[2].Width=110;list.Columns[3].Width=118;list.Columns[4].Width=56;list.Columns[5].Width=145;list.Columns[6].Width=72;
      list.Resize+=(s,e)=>list.Columns[0].Width=Math.Max(140,list.ClientSize.Width-611);
      layout.Controls.Add(list,0,1);
      info=new Label{Dock=DockStyle.Fill,ForeColor=Color.FromArgb(222,181,100),Padding=new Padding(8,12,8,0)};layout.Controls.Add(info,0,2);
      list.SelectedIndexChanged+=(s,e)=>{if(!rendering){UpdateInfo();NotifySelection();}};
      list.DoubleClick+=(s,e)=>{if(SelectionReady&&JoinRequested!=null)JoinRequested(this,EventArgs.Empty);};
      refresh.Click+=async(s,e)=>await RefreshRooms();
      timer=new System.Windows.Forms.Timer{Interval=5000};timer.Tick+=async(s,e)=>{if(Visible&&Enabled)await RefreshRooms();};timer.Start();
      VisibleChanged+=async(s,e)=>{if(Visible&&Enabled)await RefreshRooms();};
      Disposed+=(s,e)=>{closing=true;revision++;timer.Stop();timer.Dispose();};
      UpdateInfo();
    }
    void NotifySelection(){if(SelectionChanged!=null)SelectionChanged(this,EventArgs.Empty);}
    public void SetContext(string server,int serverPort,string account){
      string next=server+":"+serverPort+"/"+account;
      if(context==next)return;
      context=next;host=server;port=serverPort;revision++;entries.Clear();fetched=DateTime.MinValue;
      message="방 목록을 불러오는 중…";Render();
    }
    public void SetFilter(string value){if(filter==value)return;filter=value;Render();}
    public Task RefreshRooms(){
      if(closing||IsDisposed)return Task.FromResult(0);
      if(refreshTask!=null&&!refreshTask.IsCompleted)return refreshTask;
      refreshTask=RefreshCore();return refreshTask;
    }
    async Task RefreshCore(){
      int currentRevision=revision;string server=host;int serverPort=port;
      refresh.Enabled=false;
      try{
        string node=nodePath();
        string output=await Task.Run(()=>{
          using(var p=new Process()){
            var captured=new StringBuilder();object gate=new object();
            p.StartInfo=new ProcessStartInfo{FileName=node,Arguments="\""+Path.Combine(support,"central-rooms.mjs")+"\" "+server+" "+serverPort,
              UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,WorkingDirectory=support,
              RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
            p.OutputDataReceived+=(s,e)=>{if(e.Data!=null)lock(gate){if(captured.Length<300000)captured.AppendLine(e.Data);}};
            p.ErrorDataReceived+=(s,e)=>{};
            p.Start();p.BeginOutputReadLine();p.BeginErrorReadLine();var elapsed=Stopwatch.StartNew();
            while(!p.WaitForExit(100))if(closing||elapsed.ElapsedMilliseconds>10000){try{p.Kill();p.WaitForExit(1000);}catch{}throw new IOException("서버 응답이 없습니다. 연결 상태를 확인하고 새로고침하세요.");}
            p.WaitForExit();lock(gate)return captured.ToString();
          }
        });
        if(closing||IsDisposed||revision!=currentRevision)return;
        var data=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(output);object ok,items,error;
        if(data==null||!data.TryGetValue("ok",out ok)||!(ok is bool)||!(bool)ok)
          throw new IOException(data!=null&&data.TryGetValue("message",out error)?Convert.ToString(error):"방 목록을 불러오지 못했습니다.");
        if(!data.TryGetValue("rooms",out items)||!(items is IEnumerable))throw new IOException("방 목록 형식이 올바르지 않습니다.");
        var next=new List<RoomEntry>();foreach(var item in (IEnumerable)items)next.Add(RoomEntry.Parse(item as Dictionary<string,object>));
        if(next.Select(r=>r.RoomId).Distinct().Count()!=next.Count)throw new IOException("중복된 방 정보를 받았습니다.");
        entries=next;fetched=DateTime.UtcNow;
        message=entries.Count==0?"현재 개설된 방이 없습니다.\n친구가 방을 만들면 여기에 표시됩니다.":"방을 선택한 뒤 ‘선택한 방 참가’를 누르세요.\n개인전은 빈자리가 있으면 진행 중에도 참가할 수 있습니다.";
      }catch(Exception ex){
        if(closing||IsDisposed||revision!=currentRevision)return;
        entries.Clear();fetched=DateTime.MinValue;
        message=ex.Message.Contains("AUTH_")||ex.Message.Contains("SESSION_")?"로그인하면 개설된 방을 볼 수 있습니다. 오른쪽 위 ‘로그인 / 계정’을 눌러 주세요.":ex.Message;
      }finally{if(!closing&&!IsDisposed){refresh.Enabled=true;if(revision==currentRevision)Render();}}
    }
    void Render(){
      var selected=SelectedRoom;string id=selected==null?"":selected.RoomId;
      rendering=true;list.BeginUpdate();list.Items.Clear();
      foreach(var room in entries.Where(r=>(r.RoomName+" "+r.Code+" "+r.HostName+" "+r.MapName+" "+r.ModeName).IndexOf(filter.Trim(),StringComparison.OrdinalIgnoreCase)>=0)){
        var row=new ListViewItem(new[]{room.RoomName==""?room.HostName+"의 방":room.RoomName,room.HostName,room.MapName,room.ModeName,room.Players+" / "+room.MaxPlayers,room.StateName,room.Code}){Tag=room};
        if(!room.CanJoin)row.ForeColor=Color.FromArgb(146,158,166);
        list.Items.Add(row);if(room.RoomId==id)row.Selected=true;
      }
      list.EndUpdate();rendering=false;serverLabel.Text="서버 "+host+" · "+entries.Count+"개 방 · 5초마다 갱신";
      UpdateInfo();NotifySelection();
    }
    void UpdateInfo(){
      var room=SelectedRoom;
      info.Text=room==null?message:(room.RoomName==""?room.HostName+"의 방":room.RoomName)+" · "+room.MapName+" · "+room.ModeName+" · "+room.Limits+" · "+room.StateName+"\n"+
        (room.CanJoin?(room.GameFee==100?"대전 참가 시 1 KARMA · 대기실 입장은 무료":"장비 확인 후 참가합니다."):
          room.Build!=ReleaseTrust.GameBuild?"방장과 참가자 모두 최신 클라이언트로 실행해 주세요.":"현재 이 방에는 참가할 수 없습니다. 다른 방을 선택하거나 새로고침하세요.");
    }
  }
}
