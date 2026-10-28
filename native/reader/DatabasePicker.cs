using System.Runtime.InteropServices;
using System.Text;
namespace GameLibraryGuard;

public record DatabaseChoice(bool cancelled, string? db_path);
public static class DatabasePicker
{
    // Unicode OPENFILENAMEW layout from the Windows SDK commdlg.h (non-Mac fields).
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct OpenFileName {
        public uint size; public IntPtr owner, instance;
        public string? filter; public IntPtr customFilter; public uint maxCustomFilter, filterIndex;
        public StringBuilder file; public uint maxFile; public IntPtr fileTitle; public uint maxFileTitle;
        public string? initialDirectory, title; public uint flags; public ushort fileOffset, extensionOffset;
        public string? defaultExtension; public IntPtr customData, hook; public string? template;
        public IntPtr reserved; public uint reservedNumber, flagsEx;
    }
    [DllImport("comdlg32.dll",CharSet=CharSet.Unicode,ExactSpelling=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    static extern bool GetOpenFileNameW(ref OpenFileName options);
    [DllImport("comdlg32.dll",ExactSpelling=true)] static extern uint CommDlgExtendedError();
    [DllImport("user32.dll",ExactSpelling=true)] static extern IntPtr GetForegroundWindow();

    static string? ShowDialog() {
        if(!OperatingSystem.IsWindows())throw new PlatformNotSupportedException("The database chooser requires Windows. Enter the games.db path instead.");
        var initial=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"Playnite","library");
        var options=new OpenFileName { size=(uint)Marshal.SizeOf<OpenFileName>(),owner=GetForegroundWindow(),
            filter="Playnite library (games.db)\0games.db\0\0",filterIndex=1,file=new StringBuilder(32768),maxFile=32768,
            title="Game Library Guard - Choose Playnite games.db",initialDirectory=Directory.Exists(initial)?initial:null,
            flags=0x00080000|0x00001000|0x00000800|0x00000008|0x02000000 };
        if(GetOpenFileNameW(ref options))return options.file.ToString();
        uint error=CommDlgExtendedError();if(error!=0)throw new IOException("Windows database chooser failed (code "+error+"). Enter the full path instead.");
        return null;
    }
    public static DatabaseChoice Choose(Func<string?>? dialog=null) {
        var path=(dialog??ShowDialog)();if(string.IsNullOrEmpty(path))return new DatabaseChoice(true,null);
        path=Path.GetFullPath(path);
        if(!string.Equals(Path.GetFileName(path),"games.db",StringComparison.OrdinalIgnoreCase)||path.Length>1024)
            throw new InvalidDataException("Select Playnite's games.db file.");
        if(!File.Exists(path))throw new FileNotFoundException("The selected games.db no longer exists.");
        return new DatabaseChoice(false,path);
    }
}
