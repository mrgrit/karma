using System;
using System.Reflection;
using System.Windows.Forms;
using KarmaLocal;
class RulesDialogTests {
 static T Field<T>(object o,string n){return (T)o.GetType().GetField(n,BindingFlags.Instance|BindingFlags.NonPublic).GetValue(o);}
 static void Check(bool x,string m){if(!x)throw new Exception(m);}
 [STAThread] static void Main(string[] args){
  Application.EnableVisualStyles();
  using(var d=new AuthDialog(".",args[0],"unused","127.0.0.1",29020)){
   var tabs=Field<TabControl>(d,"tabs");tabs.SelectedIndex=1;
   var consent=Field<CheckBox>(d,"rulesConsent");var action=Field<Button>(d,"action");
   Check(!consent.Checked&&!action.Enabled,"Signup requires explicit consent");
   consent.Checked=true;Check(action.Enabled,"Consent enables validated signup");
   consent.Checked=false;Check(!action.Enabled,"Removing consent disables signup");
   d.ShowRules();action=Field<Button>(d,"action");
   Check(!action.Enabled,"Existing users also default to unchecked consent");
   Check(!Field<Timer>(d,"timer").Enabled,"Account timer cannot auto-enable acceptance");
  }
  Console.WriteLine("PASS native consent controls: unchecked signup/re-consent, explicit enable/disable, no timer auto-accept; no dialog displayed or network request made.");
 }
}
