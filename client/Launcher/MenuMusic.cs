using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;

namespace KarmaLocal {
  public interface IMenuMusicPlayer : IDisposable {
    bool IsPlaying {get;}
    void Play(string filename);
    void Stop();
  }
  // Reuse the original local menu.wma. No network player, loop, helper window
  // or input hook is needed. A unique alias isolates the launcher from the game.
  public sealed class MciMenuMusicPlayer : IMenuMusicPlayer {
    [DllImport("winmm.dll",CharSet=CharSet.Unicode,EntryPoint="mciSendStringW")]
    static extern uint Send(string command,StringBuilder result,int length,IntPtr callback);
    readonly string alias="karma_menu_"+Guid.NewGuid().ToString("N");
    readonly int volume;bool opened,disposed;
    public MciMenuMusicPlayer(int volume=250){this.volume=Math.Max(0,Math.Min(1000,volume));}
    string Command(string command){
      var result=new StringBuilder(256);uint error=Send(command,result,result.Capacity,IntPtr.Zero);
      if(error!=0)throw new InvalidOperationException("음악 재생 장치를 사용할 수 없습니다. ("+error+")");
      return result.ToString().Trim();
    }
    public void Play(string filename){
      if(disposed)throw new ObjectDisposedException("MciMenuMusicPlayer");
      Stop();filename=Path.GetFullPath(filename);if(!File.Exists(filename))throw new FileNotFoundException("원본 메뉴 음악을 찾을 수 없습니다.",filename);
      Command("open \""+filename+"\" type mpegvideo alias "+alias);opened=true;
      try{Command("set "+alias+" time format milliseconds");Command("setaudio "+alias+" volume to "+volume);Command("play "+alias+" from 0");}
      catch{Stop();throw;}
    }
    public bool IsPlaying{get{return opened&&!disposed&&String.Equals(Command("status "+alias+" mode"),"playing",StringComparison.OrdinalIgnoreCase);}}
    public void Stop(){if(!opened)return;opened=false;Send("stop "+alias,null,0,IntPtr.Zero);Send("close "+alias,null,0,IntPtr.Zero);}
    public void Dispose(){Stop();disposed=true;}
  }
  // One attempt for this launcher lifetime, after the first successful account
  // connection. Refresh/reconnect/lobby return never replays the greeting.
  public sealed class MenuMusic : IDisposable {
    readonly IMenuMusicPlayer player;readonly string filename;bool disposed;
    public bool Attempted {get;private set;}
    public bool Playing {get;private set;}
    public bool Failed {get;private set;}
    public MenuMusic(string filename,IMenuMusicPlayer player){this.filename=filename;this.player=player;}
    public void Connected(bool gameRunning){
      if(disposed||Attempted)return;Attempted=true;if(gameRunning)return;
      try{player.Play(filename);Playing=true;Poll(false);}catch{Failed=true;Stop();}
    }
    public void Poll(bool gameRunning){
      if(disposed)return;if(gameRunning){Stop();return;}if(!Playing)return;
      try{if(!player.IsPlaying)Stop();}catch{Failed=true;Stop();}
    }
    public void Stop(){Playing=false;try{player.Stop();}catch{Failed=true;}}
    public void Dispose(){if(disposed)return;disposed=true;Stop();try{player.Dispose();}catch{}}
  }
}
