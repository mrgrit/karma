using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace KarmaLocal {
  public static class ChatFiles {
    public static string Support {get{return Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Launcher");}}
    public static string Read(Dictionary<string,object> d,string k){object v;return d!=null&&d.TryGetValue(k,out v)?Convert.ToString(v):"";}
    public static Dictionary<string,object> State(string support){try{return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(support,"pause-chat-state.json"),Encoding.UTF8));}catch{return null;}}
    public static List<Dictionary<string,object>> Messages(Dictionary<string,object> state){
      object v;return state!=null&&state.TryGetValue("messages",out v)&&v is IEnumerable?((IEnumerable)v).Cast<object>().OfType<Dictionary<string,object>>().ToList():new List<Dictionary<string,object>>();
    }
    public static string Line(Dictionary<string,object> m){return (Read(m,"channel")=="team"?"[팀] ":"[전체] ")+Read(m,"name")+": "+Read(m,"text");}
    public static void Send(string support,string channel,string text){
      text=text.Trim();if(text.Length==0||text.Length>200)throw new InvalidDataException("채팅은 1~200자로 입력해 주세요.");
      if(channel!="all"&&channel!="team")throw new InvalidDataException("채팅 대상을 선택해 주세요.");
      string id=Guid.NewGuid().ToString("N"),file=Path.Combine(support,"pause-chat-send-"+DateTime.UtcNow.Ticks+"-"+id+".json");
      File.WriteAllText(file+".tmp",new JavaScriptSerializer().Serialize(new {requestId=id,channel=channel,text=text}),Encoding.UTF8);File.Move(file+".tmp",file);
    }
  }
  public sealed class ChatPanel : UserControl {
    readonly string support;readonly RichTextBox history;readonly TextBox input;readonly ComboBox channel;readonly Label error;
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer{Interval=250};string signature="";bool teamMode;
    public event Action Sent;
    public ChatPanel(string directory){
      support=directory;Dock=DockStyle.Fill;Font=new Font("Malgun Gothic",10);MinimumSize=new Size(240,150);
      var layout=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=4,Margin=Padding.Empty};layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,36));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,24));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,24));Controls.Add(layout);
      layout.Controls.Add(new Label{Text="비속어 자동 마스킹 · 전체/팀 채팅 원문은 관리자에게 보관됩니다.",Dock=DockStyle.Fill,AutoEllipsis=true,Font=new Font("Malgun Gothic",9),ForeColor=Color.Silver},0,3);
      history=new RichTextBox{Name="ChatHistory",Dock=DockStyle.Fill,ReadOnly=true,DetectUrls=false,BackColor=Color.FromArgb(25,35,43),ForeColor=Color.White,BorderStyle=BorderStyle.FixedSingle};layout.Controls.Add(history,0,0);
      var row=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=3,Margin=Padding.Empty};row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,90));row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,76));layout.Controls.Add(row,0,1);
      channel=new ComboBox{Name="ChatChannel",DropDownStyle=ComboBoxStyle.DropDownList,Dock=DockStyle.Fill};channel.Items.Add("전체");channel.SelectedIndex=0;
      input=new TextBox{Name="ChatInput",MaxLength=200,Dock=DockStyle.Fill};var send=new Button{Name="SendChat",Text="보내기",Dock=DockStyle.Fill};row.Controls.Add(channel,0,0);row.Controls.Add(input,1,0);row.Controls.Add(send,2,0);
      error=new Label{Name="ChatNotice",Text="Enter 전송 · 최대 200자",Dock=DockStyle.Fill,AutoEllipsis=true,ForeColor=Color.FromArgb(222,181,100)};layout.Controls.Add(error,0,2);
      send.Click+=(s,e)=>Send();input.KeyDown+=(s,e)=>{if(e.KeyCode==Keys.Enter){e.Handled=true;e.SuppressKeyPress=true;Send();}};
      timer.Tick+=(s,e)=>RefreshMessages();timer.Start();Disposed+=(s,e)=>{timer.Stop();timer.Dispose();};RefreshMessages();
    }
    public void SetMode(string mode){bool next=mode=="tdm";if(next==teamMode)return;teamMode=next;int selected=channel.SelectedIndex;channel.Items.Clear();channel.Items.Add("전체");if(teamMode)channel.Items.Add("팀");channel.SelectedIndex=teamMode&&selected==1?1:0;}
    public void SelectChannel(string value){channel.SelectedIndex=value=="team"&&teamMode?1:0;}
    public void FocusInput(){input.Focus();}
    void Send(){try{if(String.IsNullOrWhiteSpace(input.Text))return;ChatFiles.Send(support,channel.SelectedIndex==1?"team":"all",input.Text);input.Clear();error.Text="전송 요청됨 · Enter 전송";if(Sent!=null)Sent();}catch(Exception ex){error.Text=ex.Message;}}
    public void RefreshMessages(){
      var state=ChatFiles.State(support);if(state==null)return;SetMode(ChatFiles.Read(state,"mode"));
      var messages=ChatFiles.Messages(state);string next=String.Join("|",messages.Select(m=>ChatFiles.Read(m,"id")));
      if(next!=signature){signature=next;history.Clear();foreach(var m in messages){history.SelectionColor=ChatFiles.Read(m,"channel")=="team"?Color.FromArgb(131,205,255):Color.White;history.AppendText(ChatFiles.Line(m)+Environment.NewLine);}history.SelectionStart=history.TextLength;history.ScrollToCaret();}
      double at;double.TryParse(ChatFiles.Read(state,"errorAt"),out at);double now=(DateTime.UtcNow-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds;
      if(now-at<6000)error.Text=ChatFiles.Read(state,"error");
    }
  }
  public sealed class ChatWindow : Form {
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    readonly string commandPath;readonly IntPtr gameWindow;readonly System.Windows.Forms.Timer watcher;bool submitted;
    public ChatWindow(string path,string hwnd,int pid,string channel){
      commandPath=Path.GetFullPath(path);if(!String.Equals(Path.GetDirectoryName(commandPath),Path.GetFullPath(ChatFiles.Support),StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(commandPath).StartsWith("pause-",StringComparison.Ordinal))throw new InvalidDataException("채팅 명령 경로가 올바르지 않습니다.");
      gameWindow=new IntPtr(Convert.ToInt64(hwnd.Replace("0x",""),16));
      Text="카르마 · 채팅";ClientSize=new Size(700,380);MinimumSize=new Size(480,280);AutoScaleDimensions=new SizeF(96,96);AutoScaleMode=AutoScaleMode.Dpi;
      StartPosition=FormStartPosition.CenterScreen;TopMost=true;MinimizeBox=false;MaximizeBox=false;Font=new Font("Malgun Gothic",10);BackColor=Color.FromArgb(21,29,35);ForeColor=Color.White;Padding=new Padding(16);KeyPreview=true;
      var layout=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=2};layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));Controls.Add(layout);
      layout.Controls.Add(new Label{Text="Enter: 전송 후 게임 복귀 · Esc: 닫기 · 채팅 중에도 대전은 계속됩니다.",AutoSize=true,Dock=DockStyle.Fill,Margin=new Padding(0,0,0,12)},0,0);
      var chat=new ChatPanel(ChatFiles.Support);layout.Controls.Add(chat,0,1);chat.SelectChannel(channel);chat.Sent+=()=>Close();
      KeyDown+=(s,e)=>{if(e.KeyCode==Keys.Escape||e.KeyCode==Keys.F10){e.Handled=true;e.SuppressKeyPress=true;Close();}};
      FormClosing+=(s,e)=>{if(!submitted){File.WriteAllText(commandPath,"{\"action\":\"resume\"}",Encoding.UTF8);submitted=true;}};
      FormClosed+=(s,e)=>{watcher.Stop();watcher.Dispose();SetForegroundWindow(gameWindow);};
      Shown+=(s,e)=>{var area=Screen.FromControl(this).WorkingArea;Size=new Size(Math.Min(Width,area.Width-24),Math.Min(Height,area.Height-24));Location=new Point(area.Left+(area.Width-Width)/2,area.Top+(area.Height-Height)/2);Activate();chat.FocusInput();};
      watcher=new System.Windows.Forms.Timer{Interval=700};watcher.Tick+=(s,e)=>{try{using(var p=Process.GetProcessById(pid))if(p.HasExited)Close();}catch{Close();}};watcher.Start();
    }
  }
  // Passive, click-through notification surface; never acquires game input.
  public sealed class ChatHud : Form {
    [StructLayout(LayoutKind.Sequential)] struct Rect {public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)] struct NativePoint {public int X,Y;}
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out Rect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h,ref NativePoint p);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    readonly int pid;readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer{Interval=250};string text="";float scale=1;
    protected override bool ShowWithoutActivation{get{return true;}}
    protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x00000020|0x00000080;return p;}}
    public ChatHud(int gamePid){pid=gamePid;Text="카르마 · 채팅 알림";FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;AutoScaleMode=AutoScaleMode.None;DoubleBuffered=true;Opacity=.88;BackColor=Color.FromArgb(20,27,35);Location=new Point(-10000,-10000);timer.Tick+=(s,e)=>RefreshHud();timer.Start();FormClosed+=(s,e)=>timer.Dispose();}
    void RefreshHud(){try{
      using(var game=Process.GetProcessById(pid)){
        if(game.HasExited){Close();return;}IntPtr h=game.MainWindowHandle;
        if(h==IntPtr.Zero||GetForegroundWindow()!=h){if(Visible)Hide();return;}
        var state=ChatFiles.State(ChatFiles.Support);if(ChatFiles.Read(state,"gamePid")!=pid.ToString()){if(Visible)Hide();return;}double now=(DateTime.UtcNow-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds;
        var recent=ChatFiles.Messages(state).Where(m=>{double t;return Double.TryParse(ChatFiles.Read(m,"time"),out t)&&now-t<12000;}).Reverse().Take(3).Reverse();
        string next=String.Join("\n",recent.Select(ChatFiles.Line));double errorAt;if(Double.TryParse(ChatFiles.Read(state,"errorAt"),out errorAt)&&now-errorAt<6000)next=ChatFiles.Read(state,"error")+"\n"+next;
        if(next==""){if(Visible)Hide();return;}if(next!=text){text=next;Invalidate();}
        Rect rect;var point=new NativePoint();if(!GetClientRect(h,out rect)||!ClientToScreen(h,ref point))return;scale=Math.Max(1,GetDpiForWindow(h)/96f);
        int w=Math.Min((int)(520*scale),Math.Max(200,rect.Right-24)),height=(int)(145*scale);
        SetWindowPos(Handle,new IntPtr(-1),point.X+(int)(12*scale),point.Y+Math.Max(0,rect.Bottom-height-(int)(78*scale)),w,height,0x0010);if(!Visible)Show();
      }
    }catch(ArgumentException){Close();}catch(InvalidOperationException){Close();}}
    protected override void WndProc(ref Message m){if(m.Msg==0x84){m.Result=new IntPtr(-1);return;}if(m.Msg==0x21){m.Result=new IntPtr(3);return;}base.WndProc(ref m);}
    protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);using(var f=new Font("Malgun Gothic",13*scale,FontStyle.Regular,GraphicsUnit.Pixel))TextRenderer.DrawText(e.Graphics,text+"\nT 전체 채팅 · Y 팀 채팅",f,new Rectangle(10,8,ClientSize.Width-20,ClientSize.Height-16),Color.White,TextFormatFlags.WordBreak|TextFormatFlags.NoPadding|TextFormatFlags.EndEllipsis);}
  }
}
