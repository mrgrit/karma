using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Diagnostics;
using System.Windows.Forms;
using KarmaLocal;
class ChatUiTests {
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static Control Find(Control c,string name){if(c.Name==name)return c;foreach(Control child in c.Controls){var found=Find(child,name);if(found!=null)return found;}return null;}
 static void Click(Control c){typeof(Control).GetMethod("OnClick",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(c,new object[]{EventArgs.Empty});}
 [STAThread] static void Main(){
  string dir=ChatFiles.Support;Directory.CreateDirectory(dir);string state=Path.Combine(dir,"pause-chat-state.json"),command=Path.Combine(dir,"pause-chat-ui-close.json");
  try{
   File.WriteAllText(state,"{\"mode\":\"tdm\",\"messages\":[{\"id\":\"one\",\"name\":\"동료\",\"channel\":\"team\",\"text\":\"같이 이동해요\"}],\"errorAt\":0}");
   using(var panel=new ChatPanel(dir)){
    var channel=(ComboBox)Find(panel,"ChatChannel");var input=(TextBox)Find(panel,"ChatInput");var history=(RichTextBox)Find(panel,"ChatHistory");
    Check(channel.Items.Count==2,"team channels");Check(history.ReadOnly&&history.Text.Contains("[팀] 동료: 같이 이동해요"),"received chat visible as plain text");
    panel.SelectChannel("team");input.Text="한글 <script> & 테스트";Click(Find(panel,"SendChat"));
    string file=Directory.GetFiles(dir,"pause-chat-send-*.json").Single();string json=File.ReadAllText(file);Check(json.Contains("\"channel\":\"team\"")&&json.Contains("한글"),"team IPC delivery");Check(input.Text=="","sent input clears");File.Delete(file);
    panel.SetMode("dm");Check(channel.Items.Count==1&&channel.SelectedIndex==0,"nonteam cannot select team");
    input.Text="전체 메시지";var args=new KeyEventArgs(Keys.Enter);typeof(Control).GetMethod("OnKeyDown",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(input,new object[]{args});
    Check(args.SuppressKeyPress,"Enter must not reach game/default start");file=Directory.GetFiles(dir,"pause-chat-send-*.json").Single();Check(File.ReadAllText(file).Contains("\"channel\":\"all\""),"all IPC delivery");File.Delete(file);
   }
   using(var w=new ChatWindow(command,"0x0",Process.GetCurrentProcess().Id,"team")){
    Check(((ComboBox)Find(w,"ChatChannel")).SelectedIndex==1,"Y opens team channel");
    typeof(Form).GetMethod("OnFormClosing",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(w,new object[]{new FormClosingEventArgs(CloseReason.UserClosing,false)});
    Check(File.ReadAllText(command).Contains("resume"),"close restores input instead of exit");
   }
   Console.WriteLine("PASS chat WinForms: all/team selector, plain Korean transcript, Enter/send mailbox, isolated team mode, close resumes game.");
  }finally{File.Delete(state);File.Delete(command);foreach(string f in Directory.GetFiles(dir,"pause-chat-send-*.json"))File.Delete(f);}
 }
}
