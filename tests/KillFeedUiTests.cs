using System;using System.Collections.Generic;using System.Linq;using System.Reflection;using System.Windows.Forms;using KarmaLocal;
class KillFeedUiTests {
 static void Check(bool value,string text){if(!value)throw new Exception(text);}
 [STAThread]static void Main(){
  var items=Enumerable.Range(0,8).Select(i=>new Dictionary<string,object>{{"id",i.ToString()},{"receivedAt",1000+i},{"kind","kill"},{"killerName","학생A"},{"victimName","학생B"},{"weaponName","Kar.98k 저격소총"}}).ToArray();
  var state=new Dictionary<string,object>{{"gamePid",42},{"events",items}};
  Check(KillFeedHud.Recent(null,42,2000).Count==0,"no stale state");Check(KillFeedHud.Recent(state,99,2000).Count==0,"different game hidden");
  var rows=KillFeedHud.Recent(state,42,2000);Check(rows.Count==5&&Convert.ToString(rows[0]["id"])=="3","last five order");
  Check(KillFeedHud.Recent(state,42,8007).Count==0,"all expired after seven seconds");Check(KillFeedHud.Recent(state,42,999).Count==0,"future timestamps hidden");
  Check(KillFeedHud.Line(rows[0]).Contains("학생A → 학생B")&&KillFeedHud.Line(rows[0]).Contains("저격소총"),"names and weapon readable");
  rows[0]["kind"]="death";Check(!KillFeedHud.Line(rows[0]).Contains("학생A"),"unverified killer never named");
  using(var hud=new KillFeedHud(42)){
   var p=(CreateParams)typeof(KillFeedHud).GetProperty("CreateParams",BindingFlags.NonPublic|BindingFlags.Instance).GetValue(hud,null);
   Check((p.ExStyle&0x08000020)==0x08000020,"never activate and mouse click-through");Check(!hud.ShowInTaskbar&&hud.FormBorderStyle==FormBorderStyle.None,"passive notification");
  }
  Console.WriteLine("PASS kill-feed HUD: expiry, five rows, game isolation, compact names/weapons, no false killer, no activation or pointer capture.");
 }
}
