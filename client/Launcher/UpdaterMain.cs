using System;
using System.IO;
using System.Windows.Forms;
namespace KarmaLocal {
  internal static class UpdaterMain {
    [STAThread] static void Main(string[] args) {
      Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
      try{
        if(args.Length!=4||args[0]!="--apply")throw new ArgumentException("카르마 실행기를 통해 업데이트해 주세요.");
        string root=Path.GetFullPath(args[1]),stage=Path.GetFullPath(args[2]);
        if(!stage.StartsWith(ReleaseUpdate.StateDirectory(root)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new ArgumentException("업데이트 경로가 올바르지 않습니다.");
        Application.Run(new UpdateWindow(root,stage,Int32.Parse(args[3])));
      }catch(Exception ex){MessageBox.Show(ex.Message,"카르마 업데이트",MessageBoxButtons.OK,MessageBoxIcon.Error);}
    }
  }
}
