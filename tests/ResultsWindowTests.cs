using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;
using KarmaLocal;
class ResultsWindowTests {
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static Control Find(Control c,string name){if(c.Name==name)return c;foreach(Control child in c.Controls){var found=Find(child,name);if(found!=null)return found;}return null;}
 [STAThread] static void Main(){
  string dir=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Launcher");Directory.CreateDirectory(dir);
  string data=Path.Combine(dir,"pause-result-test-data.json"),command=Path.Combine(dir,"pause-result-test-command.json");
  try{
   File.WriteAllText(data,"{\"localPlayerId\":\"one\",\"result\":{\"reason\":\"time-limit\",\"roomName\":\"학과 대전\",\"mode\":\"dm\",\"players\":[\"one\",\"two\"],\"winnerIds\":[\"two\"],\"scores\":{\"one\":7,\"two\":9},\"deaths\":{\"one\":10,\"two\":7},\"points\":{\"one\":225,\"two\":260},\"names\":{\"one\":\"Admin\",\"two\":\"Student\"},\"killLimit\":30,\"timeLimitSeconds\":600,\"startedAt\":1000,\"endedAt\":601000}}");
   using(var w=new ResultsWindow(command,data,1)){
    Check(Find(w,"Outcome").Text=="패배 · 제한 시간 종료","reason/outcome");Check(Find(w,"MatchInfo").Text.Contains("30킬 / 10분"),"limits");
    var grid=(DataGridView)Find(w,"Scores");Check(grid.Rows.Count==2,"all players");
    Check(Convert.ToString(grid.Rows[0].Cells[1].Value)=="Student","ranked names");Check(Convert.ToInt32(grid.Rows[0].Cells[5].Value)==260,"server points");
    Check(Convert.ToString(grid.Rows[1].Cells[1].Value)=="Admin (나)","self marking");
    Check(w.AcceptButton==null&&w.CancelButton==null&&!w.ControlBox,"no accidental default exit");
    var close=new FormClosingEventArgs(CloseReason.UserClosing,false);
    typeof(Form).GetMethod("OnFormClosing",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(w,new object[]{close});Check(close.Cancel,"window close retains results");
    Check(!File.Exists(command),"no automatic leave");
    var leave=(Button)Find(w,"Leave");typeof(Button).GetMethod("OnClick",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(leave,new object[]{EventArgs.Empty});
    Check(File.ReadAllText(command).Contains("quit"),"explicit Leave exits");
   }
   using(var w=new LanSetup(true,dir)){
    NumericUpDown kills=(NumericUpDown)Find(w,"KillLimit"),rounds=(NumericUpDown)Find(w,"RoundWinLimit"),minutes=(NumericUpDown)Find(w,"TimeLimitMinutes");
    Check(kills.Minimum==1&&kills.Maximum==30&&kills.Value==10,"kill bounds/default");
    Check(rounds.Minimum==1&&rounds.Maximum==10&&rounds.Value==5,"round bounds/default");
    Check(minutes.Minimum==1&&minutes.Maximum==30&&minutes.Value==10,"time bounds/default");
   }
   Console.WriteLine("PASS result WinForms: final reason/outcome, scoreboard names/KD/points, limits, no auto-close, explicit Leave, room limit controls.");
  }finally{File.Delete(data);File.Delete(command);}
 }
}
