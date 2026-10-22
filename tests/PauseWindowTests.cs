using System;
using System.IO;
using System.Linq;
using System.Diagnostics;
using System.Reflection;
using System.Windows.Forms;
using KarmaLocal;
class PauseWindowTests {
 static string command;
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static PauseWindow Create(bool confirmation,bool lan=true){
  string dir=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Launcher");Directory.CreateDirectory(dir);
  command=Path.Combine(dir,"pause-test-"+Guid.NewGuid().ToString("N")+".json");
  return new PauseWindow(command,"0x0",Process.GetCurrentProcess().Id,lan,confirmation);
 }
 static void Key(Form window,Keys key){typeof(Form).GetMethod("OnKeyDown",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(window,new object[]{new KeyEventArgs(key)});}
 static void Click(Button button){typeof(Button).GetMethod("OnClick",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(button,new object[]{EventArgs.Empty});}
 static Button Exit(PauseWindow window){return window.Controls.OfType<Button>().Single(b=>b.Text.StartsWith("게임 종료")||b.Text=="종료");}
 static void Choice(string value){Check(File.ReadAllText(command).Contains("\""+value+"\""),"Expected choice "+value);File.Delete(command);}
 [STAThread] static void Main(){
  // Forms are constructed without showing them or sending desktop input.
  foreach(bool lan in new[]{false,true}){
   using(var w=Create(true,lan)){Check(w.Text.Contains("종료 확인"),"confirmation title");Check(((Button)w.AcceptButton).Text.StartsWith("계속하기"),"Enter defaults to cancel");Key(w,Keys.Escape);Choice("resume");}
   using(var w=Create(true,lan)){Click(Exit(w));Choice("quit");}
   using(var w=Create(false,lan)){Click(Exit(w));Check(!File.Exists(command),"first exit click only asks");Check(w.Text.Contains("종료 확인"),"menu exit asks");Click(Exit(w));Choice("quit");}
   using(var w=Create(false,lan)){Key(w,Keys.Escape);Check(!File.Exists(command),"menu Esc asks");Key(w,Keys.Escape);Choice("resume");}
   using(var w=Create(true,lan)){Click((Button)w.AcceptButton);Choice("resume");}
   using(var w=Create(true,lan)){Key(w,Keys.F10);Choice("resume");}
   using(var w=Create(true,lan)){typeof(Form).GetMethod("OnFormClosing",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(w,new object[]{new FormClosingEventArgs(CloseReason.UserClosing,false)});Choice("resume");}
  }
  Console.WriteLine("PASS: actual WinForms confirmation, explicit exit, default Enter/cancel, Esc/F10/window-close resume, menu two-step exit (LAN and practice).");
 }
}
