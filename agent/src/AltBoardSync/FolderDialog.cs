using System.Runtime.InteropServices;
using System.Runtime.Versioning;

/// <summary>
/// Choix d'un dossier par la boîte de dialogue de Windows (SHBrowseForFolder). Pas IFileOpenDialog :
/// l'interopérabilité COM intégrée est absente d'un exécutable réduit. Appelée sur le fil de la fenêtre,
/// en STA comme l'exige la boîte de dialogue.
/// </summary>
[SupportedOSPlatform("windows")]
internal static class FolderDialog
{
    private const uint ReturnOnlyFileSystemDirectories = 0x0001, NewDialogStyle = 0x0040, NoNewFolderButton = 0x0200;
    private const uint Initialized = 1, SelectionChanged = 2, SetSelection = 0x0400 + 103;
    private const uint TreeGetNextItem = 0x110A, TreeEnsureVisible = 0x1114, TreeCaret = 9;
    private const int MaxPath = 260;

    private delegate int BrowseCallback(IntPtr window, uint message, IntPtr lParam, IntPtr data);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct BROWSEINFOW
    {
        public IntPtr hwndOwner;
        public IntPtr pidlRoot;
        public IntPtr pszDisplayName;
        public string lpszTitle;
        public uint ulFlags;
        public IntPtr lpfn;
        public IntPtr lParam;
        public int iImage;
    }

    /// <param name="initial">Dossier sélectionné à l'ouverture, s'il existe.</param>
    /// <returns>Le dossier choisi, ou null si l'utilisateur a annulé.</returns>
    public static string? Pick(IntPtr owner, string title, string? initial)
    {
        var display = Marshal.AllocCoTaskMem(MaxPath * sizeof(char));
        var start = initial is not null && Directory.Exists(initial) ? Marshal.StringToCoTaskMemUni(initial) : IntPtr.Zero;
        // Gardé vivant pendant la boîte de dialogue : Windows ne détient qu'un pointeur vers lui.
        BrowseCallback callback = (window, message, _, data) =>
        {
            if (data == IntPtr.Zero) return 0;
            if (message == Initialized)
            {
                Win32.SendMessageW(window, SetSelection, 1, data);
            }
            else if (message == SelectionChanged)
            {
                // Avec le nouveau style, la sélection ne fait pas défiler l'arborescence jusqu'au dossier.
                // Sans effet ensuite : un dossier choisi par l'utilisateur est déjà visible.
                var tree = FindWindowExW(FindWindowExW(window, 0, "SHBrowseForFolder ShellNameSpace Control", null), 0, "SysTreeView32", null);
                var selected = tree == 0 ? 0 : Win32.SendMessageW(tree, TreeGetNextItem, (IntPtr)TreeCaret, 0);
                if (selected != 0) Win32.SendMessageW(tree, TreeEnsureVisible, 0, selected);
            }

            return 0;
        };
        try
        {
            var info = new BROWSEINFOW
            {
                hwndOwner = owner,
                pszDisplayName = display,
                lpszTitle = title,
                ulFlags = ReturnOnlyFileSystemDirectories | NewDialogStyle | NoNewFolderButton,
                lpfn = Marshal.GetFunctionPointerForDelegate(callback),
                lParam = start,
            };
            var selected = SHBrowseForFolderW(ref info);
            if (selected == IntPtr.Zero) return null;
            try
            {
                // Chemins longs compris : la boîte de dialogue en accepte au-delà de MAX_PATH.
                var path = new char[32_768];
                return SHGetPathFromIDListEx(selected, path, path.Length, 0) ? new string(path, 0, Array.IndexOf(path, '\0')) : null;
            }
            finally
            {
                Marshal.FreeCoTaskMem(selected);
            }
        }
        finally
        {
            GC.KeepAlive(callback);
            Marshal.FreeCoTaskMem(display);
            if (start != IntPtr.Zero) Marshal.FreeCoTaskMem(start);
        }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SHBrowseForFolderW(ref BROWSEINFOW info);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string? className, string? title);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool SHGetPathFromIDListEx(IntPtr pidl, [Out] char[] path, int length, int options);
}
