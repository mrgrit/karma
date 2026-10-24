using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Drawing;
using System.Collections;
using System.Collections.Generic;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace KarmaLocal {
  public sealed class ResultsWindow : Form {
    readonly string commandPath;
    bool leaving;
    static string TextValue(Dictionary<string,object> d,string key){object v;return d!=null&&d.TryGetValue(key,out v)?Convert.ToString(v):"";}
    static Dictionary<string,object> Map(Dictionary<string,object> d,string key){object v;return d.TryGetValue(key,out v)?v as Dictionary<string,object>:null;}
    static int Number(Dictionary<string,object> d,string key){int n;return Int32.TryParse(TextValue(d,key),out n)?n:0;}
    static string[] List(Dictionary<string,object> d,string key){object v;return d.TryGetValue(key,out v)&&v is IEnumerable?((IEnumerable)v).Cast<object>().Select(Convert.ToString).ToArray():new string[0];}
    static string SafePath(string file){
      string allowed=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Launcher"));
      string full=Path.GetFullPath(file);
      if(!String.Equals(Path.GetDirectoryName(full),allowed,StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(full).StartsWith("pause-result-",StringComparison.Ordinal))
        throw new InvalidDataException("결과 파일 경로가 올바르지 않습니다.");
      return full;
    }
    public ResultsWindow(string commandFile,string dataFile,int gamePid){
      commandPath=SafePath(commandFile);
      var data=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(SafePath(dataFile),Encoding.UTF8));
      var result=Map(data,"result");if(result==null)throw new InvalidDataException("대전 결과가 없습니다.");
      string local=TextValue(data,"localPlayerId"),mode=TextValue(result,"mode");
      var winners=List(result,"winnerIds");string outcome=winners.Length==0?"무승부":winners.Contains(local)?"승리":"패배";
      string reason=TextValue(result,"reason");
      string reasonText=reason=="kill-limit"?"목표 킬 달성":reason=="round-limit"?"목표 라운드 승수 달성":reason=="time-limit"?"제한 시간 종료":reason=="forfeit"?"상대 퇴장으로 종료":"대전 종료";
      string target=mode=="tdm"?Number(result,"roundWinLimit")+"승":Number(result,"killLimit")+"킬";
      string rules=target+" / "+(Number(result,"timeLimitSeconds")/60)+"분 · 먼저 도달하면 종료";
      double started,ended;double.TryParse(TextValue(result,"startedAt"),out started);double.TryParse(TextValue(result,"endedAt"),out ended);
      var elapsed=TimeSpan.FromMilliseconds(Math.Max(0,ended-started));
      string duration=((int)elapsed.TotalMinutes)+"분 "+elapsed.Seconds+"초";
      Text="카르마 · 최종 결과";ClientSize=new Size(800,610);MinimumSize=new Size(520,420);
      AutoScaleDimensions=new SizeF(96F,96F);AutoScaleMode=AutoScaleMode.Dpi;
      Font=new Font("Malgun Gothic",10);BackColor=Color.FromArgb(21,29,35);ForeColor=Color.White;
      ControlBox=false;TopMost=true;StartPosition=FormStartPosition.CenterScreen;
      var layout=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=5,Padding=new Padding(24)};
      layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
      layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,56));Controls.Add(layout);
      layout.Controls.Add(new Label{Text=outcome+" · "+reasonText,Name="Outcome",AutoSize=true,Dock=DockStyle.Fill,Font=new Font("Malgun Gothic",19,FontStyle.Bold),ForeColor=Color.FromArgb(222,181,100),Margin=new Padding(0,0,0,12)},0,0);
      string rounds=mode=="tdm"?"\nRED : BLUE   "+String.Join(" : ",List(result,"roundWins"))+"  (라운드 승수)":"";
      layout.Controls.Add(new Label{Text=TextValue(result,"roomName")+" · 경기 시간 "+duration+"\n"+rules+rounds,Name="MatchInfo",AutoSize=true,Dock=DockStyle.Fill,Margin=new Padding(0,0,0,18)},0,1);
      var grid=new DataGridView{Name="Scores",Dock=DockStyle.Fill,ReadOnly=true,AllowUserToAddRows=false,AllowUserToDeleteRows=false,AllowUserToResizeRows=false,
        RowHeadersVisible=false,AutoSizeColumnsMode=DataGridViewAutoSizeColumnsMode.Fill,SelectionMode=DataGridViewSelectionMode.FullRowSelect,MultiSelect=false,
        BackgroundColor=Color.FromArgb(30,40,48),BorderStyle=BorderStyle.None,AutoSizeRowsMode=DataGridViewAutoSizeRowsMode.AllCells};
      grid.DefaultCellStyle.BackColor=Color.FromArgb(30,40,48);grid.DefaultCellStyle.ForeColor=Color.White;
      grid.DefaultCellStyle.SelectionBackColor=Color.FromArgb(65,80,90);grid.ColumnHeadersHeightSizeMode=DataGridViewColumnHeadersHeightSizeMode.AutoSize;
      foreach(string heading in new[]{"순위","이름","팀","킬","데스","Point"}){int n=grid.Columns.Add(heading,heading);grid.Columns[n].SortMode=DataGridViewColumnSortMode.NotSortable;grid.Columns[n].FillWeight=n==1?230:65;}
      grid.Columns[2].Visible=mode=="tdm";
      Dictionary<string,object> scores=Map(result,"scores"),deaths=Map(result,"deaths"),points=Map(result,"points"),names=Map(result,"names"),teams=Map(result,"teams");
      var players=List(result,"players").OrderByDescending(id=>Number(scores,id)).ThenBy(id=>Number(deaths,id)).ToArray();
      int rank=0,lastKills=-1,lastDeaths=-1;
      for(int i=0;i<players.Length;i++){
        string id=players[i];int kills=Number(scores,id),dead=Number(deaths,id);
        if(kills!=lastKills||dead!=lastDeaths)rank=i+1;lastKills=kills;lastDeaths=dead;
        string name=TextValue(names,id);if(name=="")name=id;
        int row=grid.Rows.Add(rank,name+(id==local?" (나)":""),Number(teams,id)==0?"RED":"BLUE",kills,dead,Number(points,id));
        if(id==local)grid.Rows[row].DefaultCellStyle.ForeColor=Color.FromArgb(255,218,132);
      }
      layout.Controls.Add(grid,0,2);
      layout.Controls.Add(new Label{Text="Point = 이번 경기 획득 경험치 (확정 킬 25 · 사망 5)\n전적은 서버에 저장됐습니다. 결과를 확인한 뒤 퇴장을 눌러 주세요.",AutoSize=true,Dock=DockStyle.Fill,Margin=new Padding(0,16,0,14)},0,3);
      var leave=new Button{Name="Leave",Text=TextValue(data,"canReturn")=="True"?"대기실로 돌아가기":"퇴장",Dock=DockStyle.Right,Width=180,BackColor=Color.FromArgb(222,181,100),ForeColor=Color.Black};layout.Controls.Add(leave,0,4);
      leave.Click+=(s,e)=>{File.WriteAllText(commandPath,TextValue(data,"canReturn")=="True"?"{\"action\":\"lobby\"}":"{\"action\":\"quit\"}",Encoding.UTF8);leaving=true;Close();};
      // Esc, F10, Enter and accidental window-close must not discard results.
      FormClosing+=(s,e)=>{if(!leaving&&e.CloseReason==CloseReason.UserClosing)e.Cancel=true;};
      Shown+=(s,e)=>{var area=Screen.FromControl(this).WorkingArea;Size=new Size(Math.Min(Width,area.Width-24),Math.Min(Height,area.Height-24));Location=new Point(area.Left+(area.Width-Width)/2,area.Top+(area.Height-Height)/2);Activate();grid.Focus();};
    }
  }
}
