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
    readonly Timer timer=new Timer {Interval=300};
    string balance="코인 조회 대기";
    protected override bool ShowWithoutActivation {get{return true;}}
    protected override CreateParams CreateParams {get {var p=base.CreateParams;p.ExStyle|=0x08000000|0x00000020|0x00000080;return p;}}
    public CoinHud(int game,int parent) {
      gamePid=game;parentPid=parent;Text="카르마 · 내 코인";
      FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;AutoScaleMode=AutoScaleMode.None;
      BackColor=Color.FromArgb(20,27,35);ForeColor=Color.FromArgb(244,206,124);Opacity=.9;DoubleBuffered=true;
      ClientSize=new Size(230,44);StartPosition=FormStartPosition.Manual;Location=new Point(-10000,-10000);
      timer.Tick+=(s,e)=>UpdateHud();Shown+=(s,e)=>UpdateHud();FormClosed+=(s,e)=>timer.Dispose();timer.Start();
    }
    public static string ReadBalance() {
      try {
        var json=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Launcher","central-profile.json")));
        object value;if(!json.TryGetValue("coins",out value))return "코인 조회 대기";
        var coins=value as Dictionary<string,object>;
        if(coins==null||!coins.TryGetValue("available",out value)||value==null)return "코인 연결 대기";
        return (Convert.ToDecimal(value)/100m).ToString("N2")+" KARMA";
      }catch{return "코인 조회 대기";}
    }
    void UpdateHud() {
      try {
        using(var parent=Process.GetProcessById(parentPid))if(parent.HasExited){Close();return;}
        using(var game=Process.GetProcessById(gamePid)) {
          if(game.HasExited){Close();return;}IntPtr hwnd=game.MainWindowHandle;
          if(hwnd==IntPtr.Zero||GetForegroundWindow()!=hwnd||IsIconic(hwnd)){if(Visible)Hide();return;}
          Rect rect;var origin=new PointNative();if(!GetClientRect(hwnd,out rect)||!ClientToScreen(hwnd,ref origin))return;
          float scale=Math.Max(1f,GetDpiForWindow(hwnd)/96f);int w=(int)(230*scale),h=(int)(44*scale),gap=(int)(12*scale);
          SetWindowPos(Handle,new IntPtr(-1),origin.X+Math.Max(gap,rect.Right-w-gap),origin.Y+(int)(112*scale),w,h,0x0010);
          string next=ReadBalance();if(next!=balance){balance=next;Invalidate();}
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
      base.OnPaint(e);float scale=ClientSize.Height/44f;
      using(var font=new Font("Malgun Gothic",14*scale,FontStyle.Bold,GraphicsUnit.Pixel))
        TextRenderer.DrawText(e.Graphics,"내 코인   "+balance,font,ClientRectangle,ForeColor,TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter|TextFormatFlags.NoPadding);
    }
  }
}
