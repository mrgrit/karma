using System;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using KarmaLocal;

class MenuMusicTests {
  sealed class FakePlayer : IMenuMusicPlayer {
    public int Plays,Stops,Disposes;public bool Active,FailPlay,FailStatus;
    public bool IsPlaying {get {if(FailStatus)throw new Exception("device removed");return Active;}}
    public void Play(string file){Plays++;if(FailPlay)throw new Exception("missing track");Active=true;}
    public void Stop(){Stops++;Active=false;}
    public void Dispose(){Disposes++;}
  }
  static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
  static void Lifecycle(){
    var p=new FakePlayer();var music=new MenuMusic("menu.wma",p);
    music.Poll(false);Check(p.Plays==0&&!music.Attempted,"opening before successful connection stays silent");
    music.Connected(false);Check(p.Plays==1&&music.Playing,"first connection plays");
    music.Connected(false);music.Connected(false);Check(p.Plays==1,"refresh and reconnect do not replay");
    p.Active=false;music.Poll(false);Check(!music.Playing&&p.Stops==1,"natural completion closes device");
    music.Connected(false);Check(p.Plays==1,"completion never loops");
    music.Dispose();music.Dispose();music.Connected(false);Check(p.Disposes==1&&p.Plays==1,"closed launcher cannot play");

    p=new FakePlayer();music=new MenuMusic("menu.wma",p);music.Connected(false);music.Stop();music.Connected(false);
    Check(p.Plays==1&&!music.Playing,"manual mute is final for this launcher");music.Dispose();
    p=new FakePlayer();music=new MenuMusic("menu.wma",p);music.Connected(false);music.Poll(true);music.Poll(false);music.Connected(false);
    Check(p.Plays==1&&!p.Active,"game start stops music; lobby return stays silent");music.Dispose();
    p=new FakePlayer();music=new MenuMusic("menu.wma",p);music.Connected(true);music.Connected(false);
    Check(p.Plays==0&&music.Attempted,"connection during active game skips greeting");music.Dispose();

    p=new FakePlayer{FailPlay=true};music=new MenuMusic("missing.wma",p);music.Connected(false);music.Connected(false);
    Check(music.Failed&&!music.Playing&&p.Plays==1&&p.Stops==1,"missing audio fails safely without repeated attempts");music.Dispose();
    p=new FakePlayer();music=new MenuMusic("menu.wma",p);music.Connected(false);p.FailStatus=true;music.Poll(false);
    Check(music.Failed&&!music.Playing&&!p.Active,"device failure stops safely");music.Dispose();
    p=new FakePlayer();music=new MenuMusic("menu.wma",p);music.Connected(false);
    Check(p.Plays==1,"new launcher session can play once again");music.Dispose();
    Console.WriteLine("PASS music lifecycle: first connection only, refresh/reconnect, completion, stop, gameplay, disposal and device failures.");
  }
  [DllImport("winmm.dll",CharSet=CharSet.Unicode,EntryPoint="mciSendStringW")]
  static extern uint Send(string command,StringBuilder value,int length,IntPtr callback);
  static string Command(string command){var value=new StringBuilder(256);uint error=Send(command,value,value.Capacity,IntPtr.Zero);Check(error==0,"MCI probe failed: "+command+" / "+error);return value.ToString().Trim();}
  static string Alias(MciMenuMusicPlayer player){return (string)typeof(MciMenuMusicPlayer).GetField("alias",BindingFlags.NonPublic|BindingFlags.Instance).GetValue(player);}
  static void Native(string path){
    using(var player=new MciMenuMusicPlayer(0))using(var other=new MciMenuMusicPlayer(0))using(var music=new MenuMusic(path,player)){
      music.Connected(false);Check(music.Playing&&!music.Failed,"original WMA decodes and plays");
      string alias=Alias(player);int length=int.Parse(Command("status "+alias+" length"));
      Thread.Sleep(350);int position=int.Parse(Command("status "+alias+" position"));Check(position>0,"native playback advances");
      other.Play(path);Check(other.IsPlaying&&player.IsPlaying&&Alias(other)!=alias,"independent aliases");other.Stop();Check(player.IsPlaying,"stopping another player does not stop this track");
      Command("play "+alias+" from "+Math.Max(0,length-200));Thread.Sleep(650);
      Check(!player.IsPlaying,"track ends without repeat");music.Poll(false);Check(!music.Playing,"completed track closes");
      music.Connected(false);Check(!music.Playing,"native track does not restart on reconnect");
      Console.WriteLine("PASS native WMA at zero volume: length="+length+" ms, advanced="+position+" ms, isolated aliases, natural completion without loop.");
    }
  }
  [STAThread] static void Main(string[] args){Lifecycle();if(args.Length>0)Native(args[0]);}
}
