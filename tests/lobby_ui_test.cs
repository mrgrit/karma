using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using KarmaLocal;

// Creates controls and renders only into an in-memory bitmap. No desktop window,
// input simulation, real account, or live game is required.
static class KarmaLobbyValidation {
  static void Check(bool value,string message){if(!value)throw new Exception(message);}
  static T Field<T>(object value,string name){return (T)value.GetType().GetField(name,BindingFlags.Instance|BindingFlags.NonPublic).GetValue(value);}
  static Dictionary<string,object> Member(string id,bool ready){return new Dictionary<string,object>{{"playerId",id},{"name",id=="one"?"방장":"참가 학생"},{"team",id=="one"?0:1},{"ready",ready}};}
  static Dictionary<string,object> State(bool hostReady,bool guestReady,bool host=true){return new Dictionary<string,object>{
    {"roomId","ui-room"},{"roomName","학과 친구들과 팩토리 한 판"},{"code","123456"},{"mode","dm"},
    {"players",2},{"maxPlayers",8},{"hostId","one"},{"localPlayerId",host?"one":"two"},{"isHost",host},
    {"killLimit",10},{"timeLimitSeconds",600},{"roundWinLimit",5},{"map",7},{"mapName","Factory"},{"roomSettingsEditable",true},{"manualStart",true},{"canStart",hostReady&&guestReady},{"startReason",guestReady?"":"모든 참가자가 준비 완료해야 합니다."},
    {"gameFee",100},{"message","코드 123456 · 2 / 8명 · 장비 설정 후 준비 완료를 누르세요."},
    {"members",new object[]{Member("one",hostReady),Member("two",guestReady)}}};}
  [STAThread] static int Main(string[] args){
    Application.EnableVisualStyles();
    int readyRequests=0,gearRequests=0;bool desiredReady=false;
    var pending=new TaskCompletionSource<int>();
    using(var lobby=new LobbyWindow(id=>{},(id,ready)=>{Check(id=="ui-room","ready room id");readyRequests++;desiredReady=ready;return Task.FromResult(0);},id=>{gearRequests++;return pending.Task;},()=>{},null,(id,state)=>Task.FromResult(0))){
      var start=Field<Button>(lobby,"begin");var ready=Field<Button>(lobby,"readyButton");var gear=Field<Button>(lobby,"equipment");
      lobby.UpdateLobby(State(false,false));Check(!start.Enabled,"Unready lobby cannot start");Check(Field<Button>(lobby,"roomSettings").Enabled,"Host can edit room");Check(ready.Text=="준비 완료","Initial ready action");
      Check(Field<Label>(lobby,"title").Text.Contains("학과 친구들과"),"Room name visible");
      Check(Field<ListBox>(lobby,"members").Items.Count==2,"Both unready seats visible");
      lobby.UpdateLobby(State(true,false));Check(!start.Enabled,"Guest configuring blocks start");Check(ready.Text=="준비 취소","Ready host can cancel");
      lobby.UpdateLobby(State(true,true));Check(start.Enabled,"All ready host can start");
      var run=(Task)lobby.GetType().GetMethod("Perform",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(lobby,new object[]{new Func<Task>(()=>{gearRequests++;return pending.Task;})});
      Check(!start.Enabled&&!ready.Enabled&&!gear.Enabled,"Pending equipment acknowledgement blocks local start/ready");
      lobby.UpdateLobby(State(false,true));pending.SetResult(0);
      for(int i=0;i<100&&!run.IsCompleted;i++){Application.DoEvents();System.Threading.Thread.Sleep(5);}
      Check(run.IsCompleted&&!start.Enabled&&ready.Enabled,"Equipment change leaves self unready");
      lobby.UpdateLobby(State(true,true,false));Check(!start.Enabled,"Guest never receives start authority");Check(!Field<Button>(lobby,"roomSettings").Enabled,"Guest cannot edit room");
      Check(ready.Text=="준비 취소","Guest own readiness resolved by player id");
      var action=(Task)lobby.GetType().GetMethod("Perform",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(lobby,new object[]{new Func<Task>(()=>{readyRequests++;desiredReady=false;return Task.FromResult(0);})});
      Check(action.IsCompleted&&readyRequests==1&&!desiredReady&&gearRequests==1,"Callbacks execute once");
      lobby.UpdateLobby(State(true,false));
      lobby.CreateControl();lobby.PerformLayout();
      if(args.Length>0){
        // An unparented control tree can render without showing a Form.
        var panel=lobby.Controls[0];panel.Font=lobby.Font;panel.BackColor=lobby.BackColor;panel.ForeColor=lobby.ForeColor;lobby.Controls.Remove(panel);panel.Dock=DockStyle.None;panel.Size=lobby.ClientSize;panel.CreateControl();panel.PerformLayout();
        using(var image=new Bitmap(panel.Width,panel.Height)){panel.DrawToBitmap(image,new Rectangle(Point.Empty,image.Size));image.Save(args[0]);}panel.Dispose();
      }
      Check(!lobby.Visible,"Validation never displays the lobby");
    }
    var editState=State(false,false);editState["availableMaps"]=new object[]{new Dictionary<string,object>{{"map",7},{"name","Factory"},{"maxPlayers",8}},new Dictionary<string,object>{{"map",19},{"name","Honor"},{"maxPlayers",4}}};
    using(var editor=new RoomSettingsDialog(editState)){Check((int)editor.Settings["map"]==7,"Current map selected");Field<ComboBox>(editor,"mapBox").SelectedIndex=1;Check((int)editor.Settings["maxPlayers"]<=4,"Honor caps room size");Check(!editor.Visible,"Settings validation is hidden");}
    using(var setup=new LanSetup(true,Path.GetTempPath())){Check(Field<TextBox>(setup,"roomName").MaxLength==32,"Room name length matches server");Check(!setup.Visible,"Validation never displays setup");}
    var data=new Dictionary<string,object>{{"roomId","room-one"},{"code","123456"},{"roomName","실습 후 한 판"},{"hostName","교수"},{"mapName","Factory"},{"map",7},{"mode","dm"},{"state","playing"},{"players",2},{"maxPlayers",8},{"joinable",true},{"build","karma290-central6"},{"gameFee",100}};
    var room=RoomEntry.Parse(data);Check(room.RoomName=="실습 후 한 판"&&room.CanJoin,"Named active DM room keeps midmatch join");
    data["joinable"]=false;Check(!RoomEntry.Parse(data).CanJoin,"Closed or stale room disables join");
    Console.WriteLine("PASS hidden WinForms lobby: unready/ready host and guest, pending equipment state, room name and DM joinability.");return 0;
  }
}
