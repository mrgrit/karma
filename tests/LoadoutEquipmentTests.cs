using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using KarmaLocal;

static class LoadoutEquipmentTests {
  static void Check(bool ok,string why){if(!ok)throw new Exception(why);}
  static object Field(object value,string name){return value.GetType().GetField(name,BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic).GetValue(value);}
  static void Pick(LoadoutDialog dialog,string slot,int id){
    foreach(object row in (IEnumerable)Field(dialog,"rows"))if((string)Field(row,"Key")==slot){
      var picker=(ComboBox)Field(row,"Picker");
      foreach(object choice in picker.Items)if((int)Field(choice,"Id")==id){picker.SelectedItem=choice;return;}
      throw new Exception("Missing choice "+slot+":"+id);
    }
    throw new Exception("Missing slot "+slot);
  }
  [STAThread] static int Main(string[] args){
    Application.EnableVisualStyles();string support=Path.GetFullPath(args[0]);
    var data=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(support,"loadouts.json")));
    var characters=(Dictionary<string,object>)data["characters"];
    foreach(var entry in characters){
      var character=(Dictionary<string,object>)entry.Value;int xp=Convert.ToInt32(character["unlockXp"]);
      var item=new CatalogItem{Data=new Dictionary<string,object>{{"id",entry.Key},{"name",character["name"]},{"age",0}}};
      Dictionary<string,object> saved;
      using(var dialog=new LoadoutDialog(support,support,item,xp)){
        Check(dialog.SelectionValid,entry.Key+" default");int budget=dialog.Budget;
        Pick(dialog,"armor",48);Pick(dialog,"med",49);
        Check(dialog.SelectionValid,entry.Key+" vest and helmet");Check(dialog.Inventory.Length==7&&dialog.Budget==budget,"Seven slots and original budget");
        int bothCost=dialog.Cost;Pick(dialog,"med",48);Check(!dialog.SelectionValid,"Duplicate vest rejected");
        Pick(dialog,"armor",49);Check(dialog.SelectionValid,"Helmet and vest swapped");Check(dialog.Cost==bothCost,"Same total cost in either order");
        Pick(dialog,"med",49);Check(!dialog.SelectionValid,"Duplicate helmet rejected");
        Pick(dialog,"med",48);saved=new Dictionary<string,object>{{"inventory",dialog.Inventory.ToArray()},{"selectedWeapon",dialog.SelectedWeapon}};
        Pick(dialog,"armor",48);Pick(dialog,"med",24);Check(dialog.SelectionValid,"Original medkit remains usable");
        Check(!dialog.Visible,"No desktop interaction");
      }
      using(var restored=new LoadoutDialog(support,support,item,xp,saved)){
        Check(restored.SelectionValid&&restored.Inventory[4]==49&&restored.Inventory[5]==48,"Saved dual armor restored");
      }
    }
    Console.WriteLine("PASS hidden equipment UI: "+characters.Count+" characters, both armor orders, exact cost, duplicates blocked, medicine preserved, saved loadout restored.");return 0;
  }
}
