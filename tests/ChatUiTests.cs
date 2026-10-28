using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Diagnostics;
using System.Collections.Generic;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using KarmaLocal;
class ChatUiTests {
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static Control Find(Control c,string name){if(c.Name==name)return c;foreach(Control child in c.Controls){var found=Find(child,name);if(found!=null)return found;}return null;}
 static void Click(Control c){typeof(Control).GetMethod("OnClick",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(c,new object[]{EventArgs.Empty});}
 static KeyEventArgs Key(Control c,Keys key){var e=new KeyEventArgs(key);typeof(Control).GetMethod("OnKeyDown",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(c,new object[]{e});return e;}
 static void State(string path,string mode,string requestId){File.WriteAllText(path,Json.Serialize(new{mode=mode,messages=new[]{new{id="one-"+requestId,name="동료",channel="team",text="같이 이동해요",requestId=requestId}},errorAt=0}));}
 static string Pending(string dir,string channel){
  string file=Directory.GetFiles(dir,"pause-chat-send-*.json").Single();
  var message=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));
  Check(ChatFiles.Read(message,"channel")==channel,"correct mailbox channel");File.Delete(file);return ChatFiles.Read(message,"requestId");
 }
 [STAThread] static void Main(){
  string dir=ChatFiles.Support;Directory.CreateDirectory(dir);string state=Path.Combine(dir,"pause-chat-state.json"),command=Path.Combine(dir,"pause-chat-ui-close.json");
  try{
   // Hold the exact production reader open while the runtime overwrites or
   // replaces its snapshot. The former File.ReadAllText sharing mode fails
   // both operations with a real Windows sharing violation.
   State(state,"tdm","");
   using(var reader=ChatFiles.OpenStateReader(state)){
    State(state,"tdm","overlapping-write");
    Check(ChatFiles.Read(ChatFiles.Messages(ChatFiles.State(dir)).Single(),"requestId")=="overlapping-write","reader permits concurrent snapshot write");
    string moved=state+".old";File.Move(state,moved);
    try{State(state,"tdm","replacement");Check(ChatFiles.State(dir)!=null,"reader permits snapshot replacement");}finally{File.Delete(moved);}
   }
   State(state,"tdm","");
   using(var panel=new ChatPanel(dir)){
    int sent=0;panel.Sent+=()=>sent++;
    var channel=(ComboBox)Find(panel,"ChatChannel");var input=(TextBox)Find(panel,"ChatInput");var history=(RichTextBox)Find(panel,"ChatHistory");
    Check(channel.Items.Count==2,"team channels");Check(history.ReadOnly&&history.Text.Contains("[팀] 동료: 같이 이동해요"),"received chat visible as plain text");
    panel.SelectChannel("team");input.Text="한글 <script> & 테스트";Click(Find(panel,"SendChat"));
    string requestId=Pending(dir,"team");
    Check(input.Text=="한글 <script> & 테스트"&&sent==0,"send waits for server acknowledgement before closing or clearing");
    Click(Find(panel,"SendChat"));Key(input,Keys.Enter);
    Check(Directory.GetFiles(dir,"pause-chat-send-*.json").Length==0,"repeated Enter cannot send duplicates while awaiting ack");
    State(state,"tdm","another-request");panel.RefreshMessages();
    Check(sent==0&&input.Text!="","another player's echo cannot close this chat");
    File.WriteAllText(state,"{partial");panel.RefreshMessages();
    Check(sent==0&&input.Text!="","transient state read failure preserves unsent input");
    State(state,"tdm",requestId);panel.RefreshMessages();panel.RefreshMessages();
    Check(sent==1&&input.Text=="","matching server echo clears input and raises Sent exactly once");
    panel.SetMode("dm");Check(channel.Items.Count==1&&channel.SelectedIndex==0,"nonteam cannot select team");
    input.Text="전체 메시지";var args=Key(input,Keys.Enter);
    Check(args.Handled&&args.SuppressKeyPress,"Enter must not reach game/default start");requestId=Pending(dir,"all");
    typeof(ChatPanel).GetField("pendingAt",BindingFlags.Instance|BindingFlags.NonPublic).SetValue(panel,DateTime.UtcNow.AddSeconds(-9));
    State(state,"dm","");panel.RefreshMessages();
    Check(sent==1&&input.Text=="전체 메시지","ack timeout leaves chat open and retains typed message");
    Check(((Label)Find(panel,"ChatNotice")).Text.Contains("전달 확인 실패"),"ack timeout explains delivery failure");
    Click(Find(panel,"SendChat"));requestId=Pending(dir,"all");
    State(state,"dm",requestId);panel.RefreshMessages();Check(sent==2,"retry can be acknowledged");
   }
   State(state,"tdm","");
   using(var panel=new ChatPanel(dir)){
    ((TextBox)Find(panel,"ChatInput")).Text="ack during window close";Click(Find(panel,"SendChat"));string requestId=Pending(dir,"all");
    panel.Sent+=()=>panel.Dispose();State(state,"tdm",requestId);panel.RefreshMessages();
    Check(panel.IsDisposed,"server echo may synchronously dispose chat without later control access");
   }
   foreach(Keys key in new[]{Keys.Escape,Keys.F10}){
    State(state,"tdm","");File.Delete(command);
    using(var w=new ChatWindow(command,"0x0",Process.GetCurrentProcess().Id,"team")){
     Check(((ComboBox)Find(w,"ChatChannel")).SelectedIndex==1,"Y opens team channel");
     IntPtr hiddenHandle=w.Handle;
     var args=Key(w,key);Check(args.Handled&&args.SuppressKeyPress,"chat close key is consumed");
     Check(File.ReadAllText(command).Contains("\"action\":\"resume\""),"chat close writes resume, never quit");
    }
   }
   Console.WriteLine("PASS chat WinForms: concurrent Windows state write/replacement, Korean all/team chat, Enter suppression, server-ack debounce, mismatched/partial state, timeout/retry, synchronous disposal, Escape/F10 resume only. No windows displayed.");
  }finally{File.Delete(state);File.Delete(command);foreach(string f in Directory.GetFiles(dir,"pause-chat-send-*.json"))File.Delete(f);}
 }
}
