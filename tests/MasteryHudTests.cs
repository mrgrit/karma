using System;using System.IO;using System.Drawing;using System.Reflection;using System.Collections.Generic;using System.Windows.Forms;using KarmaLocal;
class MasteryHudTests {
 static void Check(bool value,string text){if(!value)throw new Exception(text);}
 [STAThread]static void Main(string[] args){
  var room=new RoomEntry{Build=ReleaseTrust.GameBuild,Joinable=true,State="waiting",Players=1,MaxPlayers=8};
  Check(room.CanJoin&&room.StateName=="대기 중","current-build waiting room must allow joining");
  room.State="playing";Check(room.CanJoin&&room.StateName=="진행 중 · 참가 가능","current-build late join");
  room.Joinable=false;Check(!room.CanJoin,"server join restriction is preserved");
  room.Joinable=true;room.Build="karma290-central5";Check(!room.CanJoin&&room.StateName=="버전 다름","old protocol remains blocked");
  Check(CoinHud.CompactLootHint("[E] MP38 · 3/30\n장문의 설명")=="[E] MP38 · 3/30","one line only");
  Check(CoinHud.CompactLootHint(new string('가',100)).Length==64,"bounded text");
  foreach(int width in new[]{800,1280,1920})foreach(float dpi in new[]{1f,1.5f,2f,3f}){
   int height=width*3/4;var b=CoinHud.HudBounds(width,height,dpi);
   Check(b.Left>=0&&b.Right<=width&&b.Top>=0&&b.Bottom<=height,"inside game viewport");
   Check(b.Height<=height*.08&&b.Width<=width*.46,"small peripheral footprint at any DPI");
   Check(b.Top>=Math.Ceiling(height*100/600f)+1,"coin must be below native portrait and health panel");
   Check(!b.Contains(width/2,height/2),"never covers crosshair");
   var loot=LootHintHud.HudBounds(width,height,dpi);
   Check(loot.Left>=width*.25&&loot.Right<=width*.75,"loot avoids native weapon and inventory at right");
   Check(loot.Top>=height*.85&&loot.Bottom<height,"loot is beneath chat and away from crosshair");
   Check(!loot.IntersectsWith(b),"coin and pickup surfaces are separate");
   var observer=LootHintHud.HudBounds(width,height,dpi,true);
   Check(observer.Left>=0&&observer.Right<=width&&observer.Top>=0&&observer.Bottom<height,"spectator caption stays inside viewport");
   Check(!observer.Contains(width/2,height/2)&&!observer.IntersectsWith(loot),"spectator caption avoids aim and pickup hint");
  }
  Check(CoinHud.SpectatorText(new Dictionary<string,object>{{"active",false}})=="","inactive spectator hides caption");
  Check(CoinHud.SpectatorText(new Dictionary<string,object>{{"active",false},{"waiting",true}}).Contains("살아 있는 아군이 없습니다"),"waiting caption");
  string observerText=CoinHud.SpectatorText(new Dictionary<string,object>{{"active",true},{"targetName","아군A"},{"hp",64},{"weaponName","MP38"},{"magazine",12},{"reserve",34}});
  Check(observerText.Contains("아군A")&&observerText.Contains("체력 64")&&observerText.Contains("12 / 34")&&observerText.Contains("← / →"),"spectator identity, health, ammunition, and controls");
  string chatDir=Path.Combine(Path.GetTempPath(),"karma-chat-ui-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(chatDir);
  try {using(var panel=new ChatPanel(chatDir)){
    bool sent=false;panel.Sent+=()=>sent=true;
    var input=(TextBox)panel.Controls.Find("ChatInput",true)[0];input.Text="전달 확인 테스트";
    typeof(ChatPanel).GetMethod("Send",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(panel,null);
    Check(!sent&&input.Text!="","must not close or clear draft before server echo");
    var serializer=new System.Web.Script.Serialization.JavaScriptSerializer();
    string request=Directory.GetFiles(chatDir,"pause-chat-send-*.json")[0];var data=serializer.Deserialize<Dictionary<string,object>>(File.ReadAllText(request));
    File.WriteAllText(Path.Combine(chatDir,"pause-chat-state.json"),serializer.Serialize(new {mode="duel",messages=new object[]{new {id="server-id",requestId=data["requestId"],text="전달 확인 테스트",name="학생",channel="all"}}}));
    panel.RefreshMessages();Check(sent&&input.Text=="","server echo acknowledges delivery");
  }}finally{foreach(string file in Directory.GetFiles(chatDir))File.Delete(file);Directory.Delete(chatDir);}
  var feed=new Dictionary<string,object>{{"kind","kill"},{"killerName","학생A"},{"victimName","학생B"},{"weaponName","Kar.98k"},{"techniqueName","링크 스피어피싱"}};
  Check(KillFeedHud.Line(feed).Contains("Kar.98k로 링크 스피어피싱 공격을 했습니다."),"specific technique label");
  if(args.Length>1){
   string root=args[1],support=Path.Combine(root,"Launcher");
   var heavy=new CatalogItem{Data=new Dictionary<string,object>{{"id","cpom_020"},{"age",0},{"name","중화기"}}};
   using(var pending=new LoadoutDialog(root,support,heavy,10000,null,0))
   using(var promoted=new LoadoutDialog(root,support,heavy,10000,null,6000)){
    Check(pending.RankName=="훈련병"&&promoted.RankName=="병장","server-qualified rank overrides raw XP");
    Check(promoted.Budget-pending.Budget==300,"budget follows earned rank");
    var preset=typeof(LoadoutDialog).GetMethod("ApplyDualPreset",BindingFlags.NonPublic|BindingFlags.Instance);
    var dual=new Dictionary<string,object>{{"cannonIds",new int[]{21,22}},{"defaultInventory",new int[]{50,9,21,22,255,255,255}},{"minXp",6000}};
    preset.Invoke(pending,new object[]{dual});Check(Array.IndexOf(pending.Inventory,21)<0||Array.IndexOf(pending.Inventory,22)<0,"XP-only dual preset blocked");
    preset.Invoke(promoted,new object[]{dual});Check(Array.IndexOf(promoted.Inventory,21)>=0&&Array.IndexOf(promoted.Inventory,22)>=0,"qualified dual preset available");
   }
  }
  using(var hud=new CoinHud(1,1)){
   Check(hud.TransparencyKey==hud.BackColor,"no opaque loot rectangle");
   var flags=(CreateParams)typeof(CoinHud).GetProperty("CreateParams",BindingFlags.NonPublic|BindingFlags.Instance).GetValue(hud,null);
   Check((flags.ExStyle&0x08000020)==0x08000020,"no activation or mouse capture");
   if(args.Length>0){
    typeof(CoinHud).GetField("lootHint",BindingFlags.NonPublic|BindingFlags.Instance).SetValue(hud,"[E] Kar.98k 저격소총 · 5/30");
    hud.ClientSize=new Size(360,44);
    using(var bitmap=new Bitmap(800,600))using(var g=Graphics.FromImage(bitmap)){
     g.Clear(Color.FromArgb(80,95,85));var area=CoinHud.HudBounds(800,600,1);
     using(var layer=new Bitmap(360,44)){
      hud.DrawToBitmap(layer,new Rectangle(0,0,360,44));layer.MakeTransparent(hud.TransparencyKey);g.DrawImageUnscaled(layer,area.Location);
     }
     using(var pen=new Pen(Color.White)){g.DrawLine(pen,394,300,406,300);g.DrawLine(pen,400,294,400,306);}
     bitmap.Save(args[0]);
    }
   }
  }
  Console.WriteLine("PASS mastery HUD: one-line technique feed; bounded pickup hints; transparent background; no focus/click capture; peripheral layout at 100–300% DPI.");
 }
}
