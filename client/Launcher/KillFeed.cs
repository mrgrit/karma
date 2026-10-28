using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Diagnostics;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace KarmaLocal {
  // A separate passive surface keeps the upper-right feed away from chat and
  // inventory hints. It never activates and is transparent to mouse input.
  public sealed class KillFeedHud : Form {
    [StructLayout(LayoutKind.Sequential)] struct Rect {public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)] struct NativePoint {public int X,Y;}
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out Rect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h,ref NativePoint p);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    readonly int pid;readonly Timer timer=new Timer{Interval=200};
    List<Dictionary<string,object>> rows=new List<Dictionary<string,object>>();string localId="",signature="";float scale=1;
    protected override bool ShowWithoutActivation{get{return true;}}
    protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x00000020|0x00000080;return p;}}
    public KillFeedHud(int gamePid){
      pid=gamePid;Text="카르마 · 해킹 알림";FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;
      AutoScaleMode=AutoScaleMode.None;DoubleBuffered=true;Opacity=.9;BackColor=Color.Magenta;TransparencyKey=BackColor;
      Location=new Point(-10000,-10000);timer.Tick+=(s,e)=>RefreshHud();timer.Start();FormClosed+=(s,e)=>timer.Dispose();
    }
    public static List<Dictionary<string,object>> Recent(Dictionary<string,object> state,int gamePid,double now){
      object value;if(ChatFiles.Read(state,"gamePid")!=gamePid.ToString()||!state.TryGetValue("events",out value)||!(value is IEnumerable))return new List<Dictionary<string,object>>();
      return ((IEnumerable)value).Cast<object>().OfType<Dictionary<string,object>>().Where(item=>{
        double at;return Double.TryParse(ChatFiles.Read(item,"receivedAt"),out at)&&now>=at&&now-at<7000;
      }).Reverse().Take(5).Reverse().ToList();
    }
    static string Particle(string name,string consonant,string vowel){if(String.IsNullOrEmpty(name))return vowel;int c=name[name.Length-1];return c>=0xac00&&c<=0xd7a3&&(c-0xac00)%28!=0?consonant:vowel;}
    public static string Line(Dictionary<string,object> item){
      string victim=ChatFiles.Read(item,"victimName"),kind=ChatFiles.Read(item,"kind");
      if(kind=="kill"){
        string killer=ChatFiles.Read(item,"killerName"),weapon=ChatFiles.Read(item,"weaponName"),technique=ChatFiles.Read(item,"techniqueName");
        return killer+Particle(killer,"이","가")+" "+victim+"에게 "+weapon+Particle(weapon,"으로","로")+" "+(String.IsNullOrEmpty(technique)?"해킹":technique)+" 공격을 했습니다.";
      }
      if(kind=="self")return victim+"  ·  자멸 ("+ChatFiles.Read(item,"weaponName")+")";
      return victim+"  ·  사망";
    }
    void RefreshHud(){try{
      using(var game=Process.GetProcessById(pid)){
        if(game.HasExited){Close();return;}IntPtr h=game.MainWindowHandle;
        if(h==IntPtr.Zero||GetForegroundWindow()!=h){if(Visible)Hide();return;}
        var state=ChatFiles.ReadState(Path.Combine(ChatFiles.Support,"pause-kill-feed.json"));
        var recent=Recent(state,pid,(DateTime.UtcNow-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds);
        if(recent.Count==0){if(Visible)Hide();return;}
        localId=ChatFiles.Read(state,"localPlayerId");string next=String.Join("|",recent.Select(r=>ChatFiles.Read(r,"id")));
        Rect rect;var point=new NativePoint();if(!GetClientRect(h,out rect)||!ClientToScreen(h,ref point))return;
        float nextScale=Math.Max(1,GetDpiForWindow(h)/96f);bool changed=next!=signature||scale!=nextScale;scale=nextScale;signature=next;rows=recent;
        int gap=(int)(8*scale),w=Math.Min((int)(620*scale),Math.Max(180,(int)(rect.Right*.72))),height=(int)(20*scale)*rows.Count;
        SetWindowPos(Handle,new IntPtr(-1),point.X+Math.Max(0,rect.Right-w-gap),point.Y+gap,w,height,0x0010);
        if(changed)Invalidate();if(!Visible)Show();
      }
    }catch(ArgumentException){Close();}catch(InvalidOperationException){Close();}}
    protected override void WndProc(ref Message m){if(m.Msg==0x84){m.Result=new IntPtr(-1);return;}if(m.Msg==0x21){m.Result=new IntPtr(3);return;}base.WndProc(ref m);}
    protected override void OnPaint(PaintEventArgs e){
      base.OnPaint(e);int rowHeight=(int)(20*scale),pad=(int)(6*scale);var flags=TextFormatFlags.Right|TextFormatFlags.VerticalCenter|TextFormatFlags.SingleLine|TextFormatFlags.EndEllipsis|TextFormatFlags.NoPadding|TextFormatFlags.NoPrefix;
      using(var font=new Font("Malgun Gothic",12*scale,FontStyle.Regular,GraphicsUnit.Pixel))using(var background=new SolidBrush(Color.FromArgb(22,29,36))){
        for(int i=0;i<rows.Count;i++){
          var item=rows[i];bool head=ChatFiles.Read(item,"kind")=="kill"&&ChatFiles.Read(item,"headshot")=="True";
          int badge=head?(int)(86*scale):0;var area=new Rectangle(0,i*rowHeight,ClientSize.Width,rowHeight-1);e.Graphics.FillRectangle(background,area);
          Color color=ChatFiles.Read(item,"victimId")==localId?Color.FromArgb(255,155,144):ChatFiles.Read(item,"killerId")==localId?Color.FromArgb(246,213,132):Color.White;
          TextRenderer.DrawText(e.Graphics,Line(item),font,new Rectangle(pad,area.Y,area.Width-2*pad-badge,area.Height),color,flags);
          if(head)TextRenderer.DrawText(e.Graphics,"(Headshot)",font,new Rectangle(area.Width-pad-badge,area.Y,badge,area.Height),Color.FromArgb(255,198,90),flags);
        }
      }
    }
  }
}
