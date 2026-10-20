using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Drawing;
using System.Globalization;
using System.Collections;
using System.Collections.Generic;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace KarmaLocal {
  public sealed class LoadoutDialog : Form {
    public int[] Inventory { get; private set; }
    public int SelectedWeapon { get; private set; }
    public int Cost { get; private set; }
    public int Budget { get; private set; }
    public string RankName { get; private set; }

    sealed class WeaponChoice {
      public int Id, Cost;
      public string Name, Category, Thumbnail;
      public bool Starting;
      public Dictionary<string,object> Data;
      public override string ToString() { return Name; }
    }
    sealed class SlotRow {
      public string Key, Name;
      public int Index, DefaultId;
      public bool Optional;
      public HashSet<int> Allowed;
      public ComboBox Picker;
      public PictureBox Picture;
      public Label Cost, Detail;
    }

    readonly Color ink=Color.FromArgb(235,238,235), muted=Color.FromArgb(162,175,181),
      accent=Color.FromArgb(222,181,100), warning=Color.FromArgb(255,175,153);
    readonly Dictionary<int,WeaponChoice> weapons=new Dictionary<int,WeaponChoice>();
    readonly Dictionary<string,Image> images=new Dictionary<string,Image>(StringComparer.OrdinalIgnoreCase);
    readonly List<SlotRow> rows=new List<SlotRow>();
    readonly ToolTip tips=new ToolTip();
    Dictionary<string,object> data, characterData;
    string assetRoot, restoredNotice="";
    int emptyId=255, originalCapacity, rankBonus, userXp;
    bool updating;
    ComboBox starting;
    Label total, reason;
    Button apply;
    Panel scroller;
    TableLayoutPanel scrollContent;

    public LoadoutDialog(string gameRoot,string support,CatalogItem character,int xp,
      Dictionary<string,object> saved=null) {
      Inventory=new int[]{50,9,1,6,48,24,18}; SelectedWeapon=9; RankName="";
      userXp=Math.Max(0,xp);
      Text="카르마 · 출전 장비";
      Font=new Font("Malgun Gothic",9F);
      AutoScaleDimensions=new SizeF(96F,96F);
      AutoScaleMode=AutoScaleMode.Dpi;
      ClientSize=new Size(800,790);
      MinimumSize=Size.Empty;
      StartPosition=FormStartPosition.CenterParent;
      BackColor=Color.FromArgb(16,22,27); ForeColor=ink;
      ShowInTaskbar=false; MinimizeBox=false;
      Shown+=(s,e)=>FitWorkingArea();
      try {
        if(character==null || character.Data==null)
          throw new InvalidDataException("캐릭터를 먼저 선택해 주세요.");
        if(character.Age!=0) {
          BuildUnavailable("미래 시대 장비는 아직 지원하지 않습니다.",
            "과거 시대 캐릭터를 선택하면 출전 장비를 고를 수 있습니다.");
          return;
        }
        assetRoot=Path.GetFullPath(gameRoot);
        if(!Directory.Exists(Path.Combine(assetRoot,"Data")) &&
          Directory.Exists(Path.Combine(assetRoot,"App_Executables","Data")))
          assetRoot=Path.Combine(assetRoot,"App_Executables");
        string source=Path.Combine(support,"loadouts.json");
        data=new JavaScriptSerializer{MaxJsonLength=4*1024*1024}
          .Deserialize<Dictionary<string,object>>(File.ReadAllText(source,Encoding.UTF8));
        if(data==null || Number(data,"schemaVersion",-1)!=1 || Number(data,"age",-1)!=0)
          throw new InvalidDataException("장비 데이터 형식을 확인할 수 없습니다.");
        var characters=Dict(data,"characters");
        object selectedCharacter;
        if(characters==null || !characters.TryGetValue(character.Id,out selectedCharacter) ||
          (characterData=selectedCharacter as Dictionary<string,object>)==null)
          throw new InvalidDataException("이 캐릭터의 장비 설정을 찾을 수 없습니다.");
        emptyId=Number(data,"emptyId",255);
        if(emptyId!=255)throw new InvalidDataException("빈 장비 항목 값이 올바르지 않습니다.");
        LoadWeapons();
        LoadBudget();
        Build(character);
        Restore(saved);
      } catch(Exception ex) {
        // Keep a recoverable launcher action when support data is missing or damaged.
        foreach(Control c in Controls.Cast<Control>().ToArray()){Controls.Remove(c);c.Dispose();}
        BuildUnavailable("장비 설정을 열 수 없습니다.",ex.Message);
        ResumeLayout(true);
      }
    }

    static string TextOf(Dictionary<string,object> d,string key,string fallback="") {
      object value;
      return d!=null && d.TryGetValue(key,out value) && value!=null ?
        Convert.ToString(value,CultureInfo.InvariantCulture):fallback;
    }
    static int Number(Dictionary<string,object> d,string key,int fallback) {
      int value;
      return Int32.TryParse(TextOf(d,key),NumberStyles.Integer,CultureInfo.InvariantCulture,out value)?value:fallback;
    }
    static bool Flag(Dictionary<string,object> d,string key,bool fallback=false) {
      bool value;return Boolean.TryParse(TextOf(d,key),out value)?value:fallback;
    }
    static Dictionary<string,object> Dict(Dictionary<string,object> d,string key) {
      object value;return d!=null&&d.TryGetValue(key,out value)?value as Dictionary<string,object>:null;
    }
    static IEnumerable<object> ArrayOf(Dictionary<string,object> d,string key) {
      object value;
      if(d==null||!d.TryGetValue(key,out value)||value==null||value is string||!(value is IEnumerable))
        return Enumerable.Empty<object>();
      return ((IEnumerable)value).Cast<object>();
    }
    static int[] IntArray(Dictionary<string,object> d,string key) {
      return ArrayOf(d,key).Select(v=>{
        int n;return Int32.TryParse(Convert.ToString(v,CultureInfo.InvariantCulture),
          NumberStyles.Integer,CultureInfo.InvariantCulture,out n)?n:-1;
      }).ToArray();
    }

    void LoadWeapons() {
      foreach(var entry in ArrayOf(data,"weapons")) {
        var w=entry as Dictionary<string,object>;
        int id=Number(w,"id",-1), cost=Number(w,"inventoryCost",-1);
        if(w==null||id<0||id>50||cost<0||cost>100000||weapons.ContainsKey(id))
          throw new InvalidDataException("무기 번호 또는 원본 장비 점수가 올바르지 않습니다.");
        weapons.Add(id,new WeaponChoice{Id=id,Cost=cost,Name=TextOf(w,"name"),
          Category=TextOf(w,"category"),Thumbnail=TextOf(w,"thumbnail"),
          Starting=Flag(w,"selectableAsStartingWeapon"),Data=w});
      }
      if(weapons.Count==0)throw new InvalidDataException("사용할 수 있는 무기가 없습니다.");
      weapons.Add(emptyId,new WeaponChoice{Id=emptyId,Cost=0,Name="장착 안 함",Category="",Thumbnail="",Starting=false});
    }
    void LoadBudget() {
      originalCapacity=Number(characterData,"inventoryCapacity",-1);
      if(originalCapacity<0||originalCapacity>100000)
        throw new InvalidDataException("캐릭터 장비 능력치가 올바르지 않습니다.");
      var ranks=ArrayOf(data,"ranks").OfType<Dictionary<string,object>>()
        .Where(r=>Number(r,"minXp",-1)>=0&&Number(r,"minXp",-1)<=userXp)
        .OrderBy(r=>Number(r,"minXp",0)).ToArray();
      if(ranks.Length==0)throw new InvalidDataException("현재 계급 정보를 찾을 수 없습니다.");
      var rank=ranks[ranks.Length-1];
      RankName=TextOf(rank,"name",TextOf(rank,"id"));rankBonus=Number(rank,"budgetBonus",-1);
      if(rankBonus<0||rankBonus>100000)throw new InvalidDataException("계급 장비 점수가 올바르지 않습니다.");
      Budget=originalCapacity+rankBonus;
    }

    Label Wrapped(string text,float size,Color color,bool bold=false) {
      return new Label{Text=text,AutoSize=true,Dock=DockStyle.Fill,Margin=new Padding(0,3,0,3),
        ForeColor=color,Font=new Font("Malgun Gothic",size,bold?FontStyle.Bold:FontStyle.Regular)};
    }
    Button MakeButton(string text) {
      var button=new Button{Text=text,AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,
        MinimumSize=new Size(110,38),Padding=new Padding(12,3,12,3),Margin=new Padding(8,0,0,0),
        FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(34,44,51),ForeColor=ink};
      button.FlatAppearance.BorderColor=Color.FromArgb(60,74,83);return button;
    }
    ComboBox MakePicker() {
      return new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Dock=DockStyle.Top,
        IntegralHeight=false,MaxDropDownItems=12,DropDownHeight=260,Margin=new Padding(0,3,0,3)};
    }
    void Build(CatalogItem character) {
      SuspendLayout();
      var frame=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=3,
        Margin=Padding.Empty,Padding=Padding.Empty};
      frame.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      frame.RowStyles.Add(new RowStyle(SizeType.AutoSize));
      frame.RowStyles.Add(new RowStyle(SizeType.Percent,100));
      frame.RowStyles.Add(new RowStyle(SizeType.AutoSize));
      Controls.Add(frame);
      var header=new TableLayoutPanel{Dock=DockStyle.Fill,AutoSize=true,ColumnCount=1,
        Padding=new Padding(20,12,20,9),Margin=Padding.Empty,BackColor=Color.FromArgb(21,29,35)};
      header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      header.Controls.Add(Wrapped(character.Name+" · "+TextOf(characterData,"roleName"),15,ink,true));
      header.Controls.Add(Wrapped(RankName+"  ·  XP "+userXp.ToString("N0")+
        "  ·  최대 "+Budget.ToString("N0")+"점  (캐릭터 "+originalCapacity.ToString("N0")+
        " + 계급 "+rankBonus.ToString("N0")+")",10,accent,true));
      header.Controls.Add(Wrapped(RoleDescription(TextOf(characterData,"role")),9,muted));
      frame.Controls.Add(header,0,0);

      scroller=new Panel{Dock=DockStyle.Fill,AutoScroll=true,Margin=Padding.Empty,
        Padding=new Padding(18,10,18,10)};
      frame.Controls.Add(scroller,0,1);
      scrollContent=new TableLayoutPanel{AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,
        ColumnCount=1,Dock=DockStyle.Top,Margin=Padding.Empty,Padding=Padding.Empty};
      scrollContent.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      scroller.Controls.Add(scrollContent);
      scroller.ClientSizeChanged+=(s,e)=>SizeScrollContent();
      var permissions=Dict(characterData,"allowedIdsBySlot");
      var slotData=ArrayOf(data,"slots").OfType<Dictionary<string,object>>()
        .OrderBy(s=>Number(s,"index",-1)).ToArray();
      if(slotData.Length!=7)throw new InvalidDataException("출전 장비는 7칸이어야 합니다.");
      for(int i=0;i<7;i++) {
        var s=slotData[i];string key=TextOf(s,"key");
        if(Number(s,"index",-1)!=i||key.Length==0||rows.Any(r=>r.Key==key))
          throw new InvalidDataException("장비 슬롯 순서가 올바르지 않습니다.");
        var all=new HashSet<int>(IntArray(s,"allowedIds"));
        int[] permitted=permissions!=null&&permissions.ContainsKey(key)?IntArray(permissions,key):all.ToArray();
        var allowed=new HashSet<int>(permitted.Where(id=>all.Contains(id)&&weapons.ContainsKey(id)));
        bool optional=Flag(s,"optional");if(optional)allowed.Add(emptyId);
        int defaultId=Number(s,"defaultId",-1);
        if(allowed.Count==0||!allowed.Contains(defaultId))
          throw new InvalidDataException(TextOf(s,"name")+"의 기본 장비가 허용 목록에 없습니다.");
        var row=new SlotRow{Index=i,Key=key,Name=TextOf(s,"name"),DefaultId=defaultId,
          Optional=optional,Allowed=allowed};
        rows.Add(row);
        BuildRow(row);
      }
      var startBox=new TableLayoutPanel{Dock=DockStyle.Top,AutoSize=true,ColumnCount=1,
        Padding=new Padding(12,9,12,10),Margin=new Padding(0,7,0,6),
        BackColor=Color.FromArgb(25,34,40)};
      startBox.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      startBox.Controls.Add(Wrapped("처음 들고 시작할 무기",10,ink,true));
      starting=MakePicker();startBox.Controls.Add(starting);
      starting.SelectedIndexChanged+=(s,e)=>{if(!updating){var w=starting.SelectedItem as WeaponChoice;
        SelectedWeapon=w==null?-1:w.Id;ValidateSelection();}};
      startBox.Controls.Add(Wrapped("현재 장착한 발사·근접 무기 중에서 선택합니다.",9,muted));
      scrollContent.Controls.Add(startBox);
      var originals=Dict(characterData,"originalStats");
      string native="원본 캐릭터: 방어력 "+Signed(TextOf(originals,"defensePercent"))+
        "% · 민첩성 "+Signed(TextOf(originals,"agilityPercent"))+"% · 능력치 "+originalCapacity.ToString("N0");
      scrollContent.Controls.Add(Wrapped(native,9,muted));
      scrollContent.Controls.Add(Wrapped(
        "장비 비용은 원본 상점의 필요능력치입니다. 역할별 허용 목록과 계급 추가 점수는 로컬 대전 규칙입니다. 계급에 따른 체력·피해 보너스는 없습니다.",
        9,muted));
      scrollContent.Controls.Add(Wrapped(
        "무기 설명의 파괴력·탄수는 원본 상점 표시값입니다. 실제 피해는 명중 부위·방어·폭발 판정에 따라 달라집니다.",
        9,muted));

      var footer=new TableLayoutPanel{Dock=DockStyle.Fill,AutoSize=true,ColumnCount=1,
        Padding=new Padding(20,8,20,12),Margin=Padding.Empty,BackColor=Color.FromArgb(23,31,37)};
      footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      total=Wrapped("",11,accent,true);footer.Controls.Add(total);
      reason=Wrapped("",9,muted);footer.Controls.Add(reason);
      var buttons=new FlowLayoutPanel{Dock=DockStyle.Top,AutoSize=true,FlowDirection=FlowDirection.RightToLeft,
        WrapContents=true,Margin=new Padding(0,7,0,0)};
      apply=MakeButton("장비 적용");apply.BackColor=accent;apply.ForeColor=Color.FromArgb(25,28,26);
      var cancel=MakeButton("취소");cancel.DialogResult=DialogResult.Cancel;
      var defaults=MakeButton("기본 장비");
      buttons.Controls.Add(apply);buttons.Controls.Add(cancel);buttons.Controls.Add(defaults);
      footer.Controls.Add(buttons);frame.Controls.Add(footer,0,2);
      AcceptButton=apply;CancelButton=cancel;
      apply.Click+=(s,e)=>{ValidateSelection();if(apply.Enabled){DialogResult=DialogResult.OK;Close();}};
      defaults.Click+=(s,e)=>{restoredNotice="";Restore(null);};
      ResumeLayout(true);
      SizeScrollContent();
    }
    void BuildRow(SlotRow row) {
      var line=new TableLayoutPanel{Dock=DockStyle.Top,AutoSize=true,ColumnCount=4,RowCount=1,
        Padding=new Padding(10,8,10,8),Margin=new Padding(0,0,0,6),
        BackColor=Color.FromArgb(25,33,39),MinimumSize=new Size(0,82)};
      line.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,92));
      line.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,76));
      line.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      line.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,78));
      line.Controls.Add(new Label{Text=row.Name,AutoSize=false,Dock=DockStyle.Fill,
        TextAlign=ContentAlignment.MiddleLeft,ForeColor=ink,Margin=Padding.Empty},0,0);
      row.Picture=new PictureBox{Size=new Size(64,64),SizeMode=PictureBoxSizeMode.Zoom,
        BackColor=Color.FromArgb(16,22,27),Margin=new Padding(0,0,12,0)};
      line.Controls.Add(row.Picture,1,0);
      var middle=new TableLayoutPanel{Dock=DockStyle.Fill,AutoSize=true,ColumnCount=1,
        Margin=Padding.Empty,Padding=Padding.Empty};
      middle.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      row.Picker=MakePicker();
      foreach(int id in row.Allowed.OrderBy(id=>id==emptyId?-1:id))row.Picker.Items.Add(weapons[id]);
      row.Detail=Wrapped("",8,muted);
      middle.Controls.Add(row.Picker);middle.Controls.Add(row.Detail);line.Controls.Add(middle,2,0);
      row.Cost=new Label{Text="",Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleRight,ForeColor=accent};
      line.Controls.Add(row.Cost,3,0);scrollContent.Controls.Add(line);
      tips.SetToolTip(row.Cost,"원본 상점 필요능력치");
      row.Picker.SelectedIndexChanged+=(s,e)=>{if(!updating)RefreshSelection();};
    }
    static string Signed(string value) {
      double number;
      if(!Double.TryParse(value,NumberStyles.Float,CultureInfo.InvariantCulture,out number))return value;
      return number>0?"+"+value:value;
    }
    static string RoleDescription(string role) {
      if(role=="scout")return "기동형 · 가벼운 소총·기관단총과 석궁을 사용할 수 있습니다.";
      if(role=="support")return "지원형 · 기관총·중화기를 사용할 수 있습니다. 기관총과 유탄·로켓 조합은 제한됩니다.";
      return "균형형 · 소총·기관단총·저격총을 사용할 수 있습니다.";
    }
    void Restore(Dictionary<string,object> saved) {
      int[] inventory=IntArray(saved,"inventory");
      int selected=Number(saved,"selectedWeapon",Number(data,"defaultSelectedWeapon",9));
      bool repaired=saved!=null&&inventory.Length!=7;
      updating=true;
      for(int i=0;i<rows.Count;i++) {
        var row=rows[i];
        int id=inventory.Length==7?inventory[i]:row.DefaultId;
        if(!row.Allowed.Contains(id)){id=row.DefaultId;repaired=true;}
        row.Picker.SelectedItem=weapons[id];
      }
      updating=false;
      SelectedWeapon=selected;
      if(repaired)restoredNotice="현재 캐릭터가 사용할 수 없는 저장 장비를 기본값으로 바꿨습니다.";
      RefreshSelection();
    }
    void RefreshSelection() {
      if(updating)return;
      int wanted=SelectedWeapon;
      Cost=0;
      foreach(var row in rows) {
        var item=row.Picker.SelectedItem as WeaponChoice;
        if(item==null){Inventory[row.Index]=-1;continue;}
        Inventory[row.Index]=item.Id;Cost+=item.Cost;
        row.Cost.Text=item.Cost.ToString("N0")+"점";
        row.Picture.Image=LoadImage(item.Thumbnail);
        row.Detail.Text=Detail(item);
        tips.SetToolTip(row.Picture,item.Name);
        tips.SetToolTip(row.Detail,row.Detail.Text);
      }
      updating=true;
      starting.Items.Clear();
      foreach(int id in Inventory.Distinct()) {
        WeaponChoice item;
        if(weapons.TryGetValue(id,out item)&&item.Starting)starting.Items.Add(item);
      }
      WeaponChoice preferred;
      if(weapons.TryGetValue(wanted,out preferred)&&starting.Items.Contains(preferred))
        starting.SelectedItem=preferred;
      else if(starting.Items.Count>0)starting.SelectedIndex=0;
      var chosen=starting.SelectedItem as WeaponChoice;
      SelectedWeapon=chosen==null?-1:chosen.Id;
      updating=false;
      ValidateSelection();
    }
    string Detail(WeaponChoice w) {
      if(w.Id==emptyId)return "이 슬롯을 비웁니다.";
      var stats=Dict(w.Data,"originalShopStats");
      string text=w.Category, effect=TextOf(stats,"effect"),power=TextOf(stats,"power"),ammo=TextOf(stats,"ammunitionDisplay");
      if(effect!="")text+=" · "+effect;
      else {
        if(power!="")text+=" · 원본 파괴력 "+power;
        if(ammo!="")text+=" · 탄수 "+ammo;
      }
      return text;
    }
    void ValidateSelection() {
      if(apply==null)return;
      var problems=new List<string>();
      foreach(var row in rows)
        if(!row.Allowed.Contains(Inventory[row.Index]))problems.Add(row.Name+"를 선택해 주세요.");
      if(Inventory.Where(id=>id!=emptyId).GroupBy(id=>id).Any(g=>g.Count()>1))
        problems.Add("같은 장비를 두 칸에 장착할 수 없습니다.");
      var heavy=Dict(Dict(data,"constraints"),"heavyCombination");
      if(heavy!=null) {
        var primary=rows.FirstOrDefault(r=>r.Key=="primary");
        var special=rows.FirstOrDefault(r=>r.Key=="special");
        if(primary!=null&&special!=null &&
          IntArray(heavy,"primaryIds").Contains(Inventory[primary.Index]) &&
          IntArray(heavy,"specialIds").Contains(Inventory[special.Index]))
          problems.Add("기관총과 유탄·로켓 특수무기는 함께 장착할 수 없습니다.");
      }
      if(Cost>Budget)problems.Add("예산을 "+(Cost-Budget).ToString("N0")+"점 초과했습니다. 장비를 바꾸거나 선택 슬롯을 비워 주세요.");
      WeaponChoice start;
      if(!Inventory.Contains(SelectedWeapon)||!weapons.TryGetValue(SelectedWeapon,out start)||!start.Starting)
        problems.Add("처음 들고 시작할 무기를 선택해 주세요.");
      int remaining=Budget-Cost;
      total.Text="합계 "+Cost.ToString("N0")+" / 최대 "+Budget.ToString("N0")+"점  ·  "+
        (remaining>=0?"남은 "+remaining.ToString("N0")+"점":"초과 "+(-remaining).ToString("N0")+"점");
      total.ForeColor=remaining<0?warning:accent;
      apply.Enabled=problems.Count==0;
      reason.ForeColor=apply.Enabled?muted:warning;
      reason.Text=problems.Count>0?String.Join("\n",problems):
        restoredNotice!=""?restoredNotice:"선택한 장비로 출전할 수 있습니다.";
    }
    Image LoadImage(string relative) {
      if(String.IsNullOrWhiteSpace(relative))return null;
      try {
        string path=Path.GetFullPath(Path.Combine(assetRoot,relative.Replace('/',Path.DirectorySeparatorChar)));
        string prefix=assetRoot.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
        if(!path.StartsWith(prefix,StringComparison.OrdinalIgnoreCase)||!File.Exists(path))return null;
        Image cached;if(images.TryGetValue(path,out cached))return cached;
        using(Image source=Image.FromFile(path))cached=new Bitmap(source);
        images.Add(path,cached);return cached;
      } catch {return null;}
    }
    void SizeScrollContent() {
      if(scroller==null||scrollContent==null)return;
      float scale=1F;using(Graphics g=CreateGraphics())scale=g.DpiX/96F;
      int minimumWidth=(int)(500*scale);
      if(scrollContent.MinimumSize.Width!=minimumWidth)
        scrollContent.MinimumSize=new Size(minimumWidth,0);
    }
    void FitWorkingArea() {
      Rectangle area=Screen.FromControl(Owner??this).WorkingArea;
      int margin=Math.Min(16,Math.Min(area.Width,area.Height)/20);
      int maxWidth=Math.Max(1,area.Width-margin*2),maxHeight=Math.Max(1,area.Height-margin*2);
      Size=new Size(Math.Min(Width,maxWidth),Math.Min(Height,maxHeight));
      Location=new Point(area.Left+(area.Width-Width)/2,area.Top+(area.Height-Height)/2);
      SizeScrollContent();
    }
    void BuildUnavailable(string title,string detail) {
      ClientSize=new Size(560,230);
      var layout=new TableLayoutPanel{Dock=DockStyle.Fill,AutoScroll=true,ColumnCount=1,
        Padding=new Padding(22),Margin=Padding.Empty};
      layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      layout.Controls.Add(Wrapped(title,12,ink,true));
      layout.Controls.Add(Wrapped(detail,10,muted));
      var close=MakeButton("닫기");close.DialogResult=DialogResult.Cancel;
      layout.Controls.Add(close);Controls.Add(layout);AcceptButton=close;CancelButton=close;
    }
    protected override void Dispose(bool disposing) {
      if(disposing){tips.Dispose();foreach(Image image in images.Values)image.Dispose();images.Clear();}
      base.Dispose(disposing);
    }
  }
}
