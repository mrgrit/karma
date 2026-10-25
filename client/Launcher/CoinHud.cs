using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace KarmaLocal {
  // A passive overlay: never activates, accepts focus or handles mouse input.
  public sealed class CoinHud : Form {
    [StructLayout(LayoutKind.Sequential)] struct Rect {public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)] struct PointNative {public int X,Y;}
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd,out Rect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd,ref PointNative point);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int w,int h,uint flags);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    public static void InitializeDpi(){try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){SetProcessDPIAware();}}
    readonly int gamePid,parentPid;
    readonly ChatHud chat;
    readonly LootHintHud loot=new LootHintHud();
    readonly KillFeedHud feed;
    readonly Timer timer=new Timer {Interval=300};
    string balance="코인 조회 대기",lootHint="";
    float displayScale=1f;
    protected override bool ShowWithoutActivation {get{return true;}}
    protected override CreateParams CreateParams {get {var p=base.CreateParams;p.ExStyle|=0x08000000|0x00000020|0x00000080;return p;}}
    public CoinHud(int game,int parent) {
      gamePid=game;parentPid=parent;Text="카르마 · 내 코인";
      FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;AutoScaleMode=AutoScaleMode.None;
      BackColor=Color.Magenta;TransparencyKey=BackColor;ForeColor=Color.FromArgb(244,206,124);Opacity=.9;DoubleBuffered=true;
      ClientSize=new Size(230,44);StartPosition=FormStartPosition.Manual;Location=new Point(-10000,-10000);
      chat=new ChatHud(gamePid);
      feed=new KillFeedHud(gamePid);
      timer.Tick+=(s,e)=>UpdateHud();Shown+=(s,e)=>{UpdateHud();chat.Show();feed.Show();};FormClosed+=(s,e)=>{timer.Dispose();chat.Close();feed.Close();loot.Close();};timer.Start();
    }
    static string ReadSharedText(string path) {
      using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))
      using(var reader=new StreamReader(stream))return reader.ReadToEnd();
    }
    public static string ReadBalance() {
      try {
        var json=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(ReadSharedText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Launcher","central-profile.json")));
        object value;if(!json.TryGetValue("coins",out value))return "코인 조회 대기";
        var coins=value as Dictionary<string,object>;
        if(coins==null||!coins.TryGetValue("available",out value)||value==null)return "코인 연결 대기";
        return (Convert.ToDecimal(value)/100m).ToString("N2")+" KARMA";
      }catch{return "코인 조회 대기";}
    }
    string ReadLootHint(){
      try{
        var value=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(ReadSharedText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Launcher","loot-hint.json")));
        object id,until,text;
        if(!value.TryGetValue("gamePid",out id)||Convert.ToInt32(id)!=gamePid||!value.TryGetValue("expiresAt",out until)||
          Convert.ToDouble(until)<(DateTime.UtcNow-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds||!value.TryGetValue("message",out text))return "";
        return CompactLootHint(Convert.ToString(text));
      }catch{return "";}
    }
    public static string CompactLootHint(string message){
      if(String.IsNullOrWhiteSpace(message))return "";
      string line=message.Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries)[0];
      return line.Length>64?line.Substring(0,63)+"…":line;
    }
    public static Rectangle HudBounds(int width,int height,float dpiScale){
      float scale=Math.Max(.75f,Math.Min(dpiScale,Math.Min(width/800f,height/600f)));
      int w=Math.Min(width,(int)(190*scale)),h=(int)(22*scale),gap=(int)(12*scale);
      // Native portrait/health panel occupies the first 100/600 of the frame.
      int portraitBottom=(int)Math.Ceiling(height*100/600f);
      return new Rectangle(gap,portraitBottom+gap,w,h);
    }
    void UpdateHud() {
      try {
        using(var parent=Process.GetProcessById(parentPid))if(parent.HasExited){Close();return;}
        using(var game=Process.GetProcessById(gamePid)) {
          if(game.HasExited){Close();return;}IntPtr hwnd=game.MainWindowHandle;
          if(hwnd==IntPtr.Zero||GetForegroundWindow()!=hwnd||IsIconic(hwnd)){if(Visible)Hide();loot.Hide();return;}
          Rect rect;var origin=new PointNative();if(!GetClientRect(hwnd,out rect)||!ClientToScreen(hwnd,ref origin))return;
          string next=ReadBalance(),hint=ReadLootHint();
          float scale=Math.Max(.75f,Math.Min(GetDpiForWindow(hwnd)/96f,Math.Min(rect.Right/800f,rect.Bottom/600f)));bool scaleChanged=displayScale!=scale;displayScale=scale;
          loot.Place(origin.X,origin.Y,rect.Right,rect.Bottom,scale,hint);
          var bounds=HudBounds(rect.Right,rect.Bottom,scale);
          SetWindowPos(Handle,new IntPtr(-1),origin.X+bounds.X,origin.Y+bounds.Y,bounds.Width,bounds.Height,0x0010);
          if(next!=balance||hint!=lootHint||scaleChanged){balance=next;lootHint=hint;Invalidate();}
          if(!Visible)Show();
        }
      }catch(ArgumentException){Close();}catch(InvalidOperationException){Close();}
    }
    protected override void WndProc(ref Message m) {
      if(m.Msg==0x0084){m.Result=new IntPtr(-1);return;}
      if(m.Msg==0x0021){m.Result=new IntPtr(3);return;}
      base.WndProc(ref m);
    }
    protected override void OnPaint(PaintEventArgs e) {
      base.OnPaint(e);float scale=displayScale;
      e.Graphics.TextRenderingHint=System.Drawing.Text.TextRenderingHint.SingleBitPerPixelGridFit;
      using(var font=new Font("Malgun Gothic",12*scale,FontStyle.Bold,GraphicsUnit.Pixel))
      using(var format=new StringFormat{Alignment=StringAlignment.Near,LineAlignment=StringAlignment.Center,FormatFlags=StringFormatFlags.NoWrap,Trimming=StringTrimming.EllipsisCharacter}){
        string[] lines={"내 코인 · "+balance};
        for(int i=0;i<lines.Length;i++){
          var area=new RectangleF(0,22*scale*i,ClientSize.Width-2,22*scale);
          var shadow=area;shadow.Offset(1,1);
          e.Graphics.DrawString(lines[i],font,Brushes.Black,shadow,format);
          using(var brush=new SolidBrush(i==0?ForeColor:Color.White))e.Graphics.DrawString(lines[i],font,brush,area,format);
        }
      }
    }
  }
  public sealed class LootHintHud : Form {
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
    string hint="";float scale=1;
    protected override bool ShowWithoutActivation{get{return true;}}
    protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x00000020|0x00000080;return p;}}
    public LootHintHud(){FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;AutoScaleMode=AutoScaleMode.None;DoubleBuffered=true;BackColor=Color.Magenta;TransparencyKey=BackColor;Location=new Point(-10000,-10000);}
    public static Rectangle HudBounds(int width,int height,float dpi){
      float s=Math.Max(.75f,Math.Min(dpi,Math.Min(width/800f,height/600f)));
      int w=Math.Min((int)(360*s),(int)(width*.45)),h=(int)(24*s);
      return new Rectangle((width-w)/2,Math.Max(0,height-(int)(62*s)),w,h);
    }
    public void Place(int x,int y,int width,int height,float dpi,string text){
      if(String.IsNullOrEmpty(text)){Hide();return;}
      bool changed=hint!=text||scale!=dpi;hint=text;scale=dpi;
      var b=HudBounds(width,height,dpi);SetWindowPos(Handle,new IntPtr(-1),x+b.X,y+b.Y,b.Width,b.Height,0x0010);if(changed)Invalidate();if(!Visible)Show();
    }
    protected override void WndProc(ref Message m){if(m.Msg==0x84){m.Result=new IntPtr(-1);return;}if(m.Msg==0x21){m.Result=new IntPtr(3);return;}base.WndProc(ref m);}
    protected override void OnPaint(PaintEventArgs e){
      base.OnPaint(e);e.Graphics.TextRenderingHint=System.Drawing.Text.TextRenderingHint.SingleBitPerPixelGridFit;
      using(var f=new Font("Malgun Gothic",12*scale,FontStyle.Bold,GraphicsUnit.Pixel))
      using(var format=new StringFormat{Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center,FormatFlags=StringFormatFlags.NoWrap,Trimming=StringTrimming.EllipsisCharacter}){
        var area=new RectangleF(0,0,ClientSize.Width-2,ClientSize.Height-2);var shadow=area;shadow.Offset(1,1);
        e.Graphics.DrawString(hint,f,Brushes.Black,shadow,format);e.Graphics.DrawString(hint,f,Brushes.White,area,format);
      }
    }
  }

}
