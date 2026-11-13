using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using AltBoardSync.Core.App;
using AltBoardSync.Core.Config;
using AltBoardSync.Core.Sync;
using static Win32;

/// <summary>
/// Fenêtre de l'agent : état de la synchronisation, démarrage avec Windows, saisie du jeton, journal
/// de ce qui a été envoyé et de ce qui a changé. Dessinée à la main aux couleurs du tableau de bord
/// (web/src/app/globals.css) ; son seul contrôle Windows est le champ du jeton, pour que coller,
/// sélectionner et le menu contextuel s'y comportent comme partout. Tout son code tourne sur le fil
/// de l'icône de la zone de notification ; les méthodes publiques s'y reportent d'elles-mêmes.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class MainWindow
{
    public sealed record Commands(Action SyncNow, Action OpenDashboard, Action OpenMachines, Action OpenLog, Action Quit);

    private enum Zone
    {
        None,
        Update,
        Autostart,
        SyncNow,
        Token,
        Dashboard,
        LogFile,
        Quit,
        ScrollThumb,
        TokenPaste,
        TokenMachines,
        TokenCancel,
        TokenSave,
    }

    private enum TokenState
    {
        Present,
        Absent,
        Unreadable,
    }

    /// <summary>Ligne du journal : un titre de jour, ou une entrée.</summary>
    private sealed record Row(float Top, float Height, string? DayLabel, JournalEntry? Entry, float NameWidth);

    private const uint Ink = 0xFF070A12, Surface = 0xFF0F1522, Raised = 0xFF161E30, RaisedHover = 0xFF1D2740, HeaderTop = 0xFF121B31;
    private const uint Line = 0x17FFFFFF, LineStrong = 0x2EFFFFFF;
    private const uint Bright = 0xFFE8ECF5, Muted = 0xFF9AA5BD, Faint = 0xFF6B7690;
    private const uint Gold = 0xFFE3BD6A, GoldHover = 0xFFF0CF85, GoldPressed = 0xFFC9A352, OnGold = 0xFF1A1408;
    private const uint Accent = 0xFF6F9BFF, Ok = 0xFF5FD39A, Danger = 0xFFF0625F;

    private const string GlyphSync = "", GlyphGlobe = "", GlyphDocument = "";
    private const string GlyphKey = "", GlyphPaste = "";
    private const nuint AnimationTimer = 1, RefreshTimer = 2, SyncTimeoutTimer = 3;
    private const float ClientWidth = 780, ClientHeight = 720, MinClientWidth = 640, MinClientHeight = 560;
    private const string ClassName = "AltBoardSyncWindow";

    // Une zone absente de l'affichage (lien de mise à jour sans mise à jour) est sautée.
    private static readonly Zone[] FocusOrder = [Zone.Update, Zone.Autostart, Zone.SyncNow, Zone.Token, Zone.Dashboard, Zone.LogFile, Zone.Quit];
    // Dans le panneau du jeton, après le champ, qui ouvre la boucle.
    private static readonly Zone[] TokenFocusOrder = [Zone.TokenPaste, Zone.TokenMachines, Zone.TokenCancel, Zone.TokenSave];
    private static readonly string[] Days = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    private static readonly string[] Months =
        ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

    private readonly Action<Action> _post;
    private readonly string _homeDirectory;
    private readonly IAutostart _autostart;
    private readonly Commands _commands;
    private readonly Action _onHidden;
    private readonly SyncJournal _journal;
    private readonly FileLog _log;
    // Gardé en champ : Windows détient un pointeur vers ce délégué tant que la fenêtre existe.
    private readonly WindowProcedure _procedure, _tokenEditProcedure;
    private readonly List<(Zone Zone, RectF Bounds)> _zones = [];
    private readonly List<Row> _rows = [];

    private IntPtr _window, _icon;
    private float _scale = 1;
    private Fonts? _fonts;

    private IReadOnlyList<JournalEntry> _entries = [];
    private string _machine = Environment.MachineName, _server = "";
    private TokenState _token;
    private bool _autostartOn;
    private float _togglePosition;
    private bool _toggleMoving;
    private bool? _failing;
    private DateTimeOffset? _retryAt;
    private bool _syncRequested;
    // Version plus récente servie par le site, à proposer ; null s'il n'y en a pas.
    private string? _update;
    // Le serveur a refusé le jeton enregistré : la saisie s'ouvre une fois, jusqu'au prochain jeton.
    private bool _tokenRejected, _tokenRejectedAsked;

    private Zone _hover, _pressed, _focus;
    private bool _focusVisible, _trackingMouse;
    private float _scroll, _contentHeight, _viewHeight, _layoutWidth = -1;
    private RectF _scrollTrack;
    private float _thumbHeight, _dragOffset;

    // Panneau du jeton : le champ est créé à sa première ouverture.
    private IntPtr _tokenEdit, _tokenEditPrevious, _tokenFieldBrush;
    private bool _tokenOpen, _tokenAsked, _tokenFieldFocused;
    private string? _tokenError;

    public MainWindow(Action<Action> post, string homeDirectory, IAutostart autostart, Commands commands, Action onHidden)
    {
        _post = post;
        _homeDirectory = homeDirectory;
        _autostart = autostart;
        _commands = commands;
        _onHidden = onHidden;
        _journal = new SyncJournal(homeDirectory, () => DateTimeOffset.UtcNow);
        _log = new FileLog(homeDirectory, () => DateTimeOffset.UtcNow);
        _procedure = Handle;
        _tokenEditProcedure = HandleTokenEdit;
    }

    /// <summary>Affiche la fenêtre et la met au premier plan ; la crée au premier appel.</summary>
    public void Show() => _post(() =>
    {
        if (_window == 0) Create();
        Reload();
        ShowWindow(_window, IsIconic(_window) ? SwRestore : SwShow);
        SetForegroundWindow(_window);
        SetTimer(_window, RefreshTimer, 20_000, 0);
        // Sans jeton rien ne part : la fenêtre le demande d'elle-même, une fois par lancement.
        if (_token != TokenState.Present && !_tokenAsked)
        {
            _tokenAsked = true;
            OpenTokenPanel();
        }

        AskRejectedToken();
        Invalidate();
    });

    /// <summary>Reporte dans la fenêtre ce que la surveillance vient de signaler.</summary>
    public void Report(WatchEvent watchEvent) => _post(() =>
    {
        switch (watchEvent)
        {
            case WatchEvent.Synced:
                _failing = false;
                _retryAt = null;
                _tokenRejected = false;
                break;
            case WatchEvent.Failed failed:
                _failing = true;
                _retryAt = DateTimeOffset.UtcNow + failed.RetryIn;
                if (failed.TokenRejected) _tokenRejected = true;
                break;
            case WatchEvent.UpdateAvailable update:
                _update = update.Version;
                // Une version annoncée ne relance pas de synchronisation : le bouton reste tel quel.
                if (_window != 0 && IsWindowVisible(_window)) Invalidate();
                return;
        }

        _syncRequested = false;
        if (_window == 0 || !IsWindowVisible(_window)) return;
        KillTimer(_window, SyncTimeoutTimer);
        Reload();
        AskRejectedToken();
        Invalidate();
    });

    /// <summary>Note dans le journal qu'un exécutable plus récent a pris la place de la surveillance en cours.</summary>
    /// <param name="previous">Version remplacée ; null pour une version antérieure à 0.8.1, qui ne la disait pas.</param>
    /// <param name="autostartCommand">Nouvelle commande du démarrage avec Windows, si elle a été réécrite.</param>
    public void ReportReplaced(string? previous, string? autostartCommand) => _post(() =>
    {
        _journal.Info(previous is null
            ? $"AltBoard Sync {AgentApp.Version} a remplacé la version précédente."
            : $"AltBoard Sync {AgentApp.Version} a remplacé la version {previous}.");
        if (autostartCommand is not null) _journal.Info($"Démarrage avec Windows : lance désormais {Environment.ProcessPath}.");
        if (_window == 0 || !IsWindowVisible(_window)) return;
        Reload();
        Invalidate();
    });

    /// <summary>Jeton refusé par le serveur : la saisie s'ouvre d'elle-même, une fois.</summary>
    private void AskRejectedToken()
    {
        if (!_tokenRejected || _tokenRejectedAsked || _tokenOpen || _window == 0 || !IsWindowVisible(_window)) return;
        _tokenRejectedAsked = true;
        OpenTokenPanel();
    }

    // ---------------------------------------------------------------------------
    // Création et données
    // ---------------------------------------------------------------------------

    private void Create()
    {
        var instance = GetModuleHandleW(null);
        var windowClass = new WNDCLASSEXW
        {
            cbSize = (uint)Marshal.SizeOf<WNDCLASSEXW>(),
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_procedure),
            hInstance = instance,
            hIcon = LoadImageW(instance, IconResource, ImageIcon, 32, 32, LoadShared),
            hIconSm = LoadImageW(instance, IconResource, ImageIcon, GetSystemMetrics(SmCxSmIcon), GetSystemMetrics(SmCySmIcon), LoadShared),
            hCursor = LoadCursorW(0, CursorArrow),
            lpszClassName = ClassName,
        };
        RegisterClassExW(ref windowClass);

        // Sur l'écran où se trouve le pointeur : celui où l'utilisateur vient de cliquer.
        GetCursorPos(out var cursor);
        var monitor = MonitorFromPoint(cursor, 2);
        var info = new MONITORINFO { cbSize = (uint)Marshal.SizeOf<MONITORINFO>() };
        GetMonitorInfoW(monitor, ref info);
        if (GetDpiForMonitor(monitor, 0, out var dpi, out _) != 0) dpi = 96;
        _scale = dpi / 96f;

        var work = info.rcWork;
        var (width, height) = OuterSize(ClientWidth, ClientHeight, dpi);
        width = Math.Min(width, work.Right - work.Left);
        height = Math.Min(height, work.Bottom - work.Top);
        // WsClipChildren : le dessin de la fenêtre ne recouvre pas le champ du jeton.
        _window = CreateWindowExW(
            0, ClassName, "AltBoard Sync", WsOverlappedWindow | WsClipChildren,
            work.Left + (work.Right - work.Left - width) / 2, work.Top + (work.Bottom - work.Top - height) / 2, width, height,
            0, 0, instance, 0);

        // Barre de titre sombre, de la couleur du haut de la fenêtre (Windows 11 ; ignoré avant).
        var enabled = 1;
        DwmSetWindowAttribute(_window, 20, ref enabled, sizeof(int));
        var caption = ColorRef(HeaderTop);
        DwmSetWindowAttribute(_window, 35, ref caption, sizeof(int));
        var captionText = ColorRef(Bright);
        DwmSetWindowAttribute(_window, 36, ref captionText, sizeof(int));

        _scale = GetDpiForWindow(_window) / 96f;
        LoadScaledResources();
    }

    private void LoadScaledResources()
    {
        _fonts?.Dispose();
        _fonts = new Fonts(_scale);
        // Le champ du jeton tenait l'ancienne police, qui vient d'être détruite.
        if (_tokenEdit != 0) SendMessageW(_tokenEdit, WmSetFont, _fonts.Body, 1);
        if (_icon != 0) DestroyIcon(_icon);
        var size = (int)S(40);
        _icon = LoadImageW(GetModuleHandleW(null), IconResource, ImageIcon, size, size, 0);
        _layoutWidth = -1;
    }

    private static (int Width, int Height) OuterSize(float clientWidth, float clientHeight, uint dpi)
    {
        var bounds = new RECT { Right = (int)(clientWidth * dpi / 96), Bottom = (int)(clientHeight * dpi / 96) };
        AdjustWindowRectExForDpi(ref bounds, WsOverlappedWindow, false, 0, dpi);
        return (bounds.Right - bounds.Left, bounds.Bottom - bounds.Top);
    }

    /// <summary>Relit ce que la fenêtre affiche : journal, configuration, jeton, démarrage avec Windows.</summary>
    private void Reload()
    {
        _entries = _journal.ReadLatest();
        _layoutWidth = -1;
        // Avant le premier signalement de la surveillance, l'état est celui de la dernière entrée.
        _failing ??= _entries.FirstOrDefault(e => e.Kind != JournalEntry.Info)?.Kind == JournalEntry.Failed;

        _autostartOn = _autostart.IsEnabled;
        // Hors d'un glissement en cours, l'interrupteur montre l'état lu : à la première lecture
        // comme après un « autostart on » lancé ailleurs.
        if (!_toggleMoving) _togglePosition = _autostartOn ? 1 : 0;

        try
        {
            var config = new AgentConfigStore(_homeDirectory).LoadOrCreate();
            _machine = string.IsNullOrWhiteSpace(config.MachineName) ? Environment.MachineName : config.MachineName;
            _server = new Uri(config.ServerUrl).Host;
        }
        catch (Exception e) when (e is InvalidDataException or UriFormatException or IOException or UnauthorizedAccessException)
        {
            _server = "configuration illisible";
        }

        var latest = new WatchStateStore(_homeDirectory).Load().LatestAgentVersion;
        _update = AgentVersions.IsNewer(latest, AgentApp.Version) ? latest : null;

        try
        {
            _token = new TokenStore(_homeDirectory).Read() is null ? TokenState.Absent : TokenState.Present;
        }
        catch (Exception e) when (e is InvalidDataException or IOException or UnauthorizedAccessException)
        {
            _token = TokenState.Unreadable;
        }
    }

    // ---------------------------------------------------------------------------
    // Messages
    // ---------------------------------------------------------------------------

    private IntPtr Handle(IntPtr window, uint message, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            switch (message)
            {
                case WmPaint:
                    OnPaint(window);
                    return 0;
                case WmEraseBackground:
                    return 1;
                case WmSize:
                    if (_tokenOpen) PlaceTokenEdit();
                    InvalidateRect(window, 0, false);
                    return 0;
                case WmSetFocus when _tokenOpen && !_focusVisible:
                    // Revenue au premier plan, la fenêtre rend le clavier au champ du jeton.
                    SetFocus(_tokenEdit);
                    return 0;
                case WmCommand when lParam == _tokenEdit && _tokenEdit != 0:
                    switch ((uint)(((long)wParam >> 16) & 0xFFFF))
                    {
                        case EnChange:
                            _tokenError = null;
                            break;
                        case EnSetFocus:
                            _tokenFieldFocused = true;
                            _focus = Zone.None;
                            _focusVisible = false;
                            break;
                        case EnKillFocus:
                            _tokenFieldFocused = false;
                            break;
                    }

                    Invalidate();
                    return 0;
                case WmCtlColorEdit when lParam == _tokenEdit && _tokenEdit != 0:
                    // Le champ se dessine lui-même : il reçoit ici les couleurs de la fenêtre.
                    SetTextColor(wParam, (uint)ColorRef(Bright));
                    SetBkColor(wParam, (uint)ColorRef(Ink));
                    if (_tokenFieldBrush == 0) _tokenFieldBrush = CreateSolidBrush((uint)ColorRef(Ink));
                    return _tokenFieldBrush;
                case WmGetMinMaxInfo:
                    // MINMAXINFO.ptMinTrackSize : troisième POINT après ptReserved, ptMaxSize et ptMaxPosition.
                    var (minWidth, minHeight) = OuterSize(MinClientWidth, MinClientHeight, (uint)MathF.Round(_scale * 96));
                    Marshal.WriteInt32(lParam, 24, minWidth);
                    Marshal.WriteInt32(lParam, 28, minHeight);
                    return 0;
                case WmDpiChanged:
                    _scale = ((long)wParam & 0xFFFF) / 96f;
                    LoadScaledResources();
                    var suggested = Marshal.PtrToStructure<RECT>(lParam);
                    SetWindowPos(window, 0, suggested.Left, suggested.Top, suggested.Right - suggested.Left, suggested.Bottom - suggested.Top, SwpNoZOrder | SwpNoActivate);
                    return 0;
                case WmMouseMove:
                    OnMouseMove(X(lParam), Y(lParam));
                    return 0;
                case WmMouseLeave:
                    _trackingMouse = false;
                    SetHover(Zone.None);
                    return 0;
                case WmLButtonDown:
                    OnMouseDown(X(lParam), Y(lParam));
                    return 0;
                case WmLButtonUp:
                    OnMouseUp(X(lParam), Y(lParam));
                    return 0;
                case WmCaptureChanged:
                    if (_pressed != Zone.None)
                    {
                        _pressed = Zone.None;
                        Invalidate();
                    }

                    return 0;
                case WmMouseWheel when !_tokenOpen:
                    ScrollBy(-(short)(((long)wParam >> 16) & 0xFFFF) / 120f * S(60));
                    return 0;
                // Seulement pour la fenêtre elle-même : le champ du jeton garde son curseur de texte.
                case WmSetCursor when ((long)lParam & 0xFFFF) == HtClient && wParam == window:
                    SetCursor(LoadCursorW(0, _hover is Zone.None or Zone.ScrollThumb ? CursorArrow : CursorHand));
                    return 1;
                case WmKeyDown:
                    OnKey((int)wParam);
                    return 0;
                case WmTimer:
                    OnTimer((nuint)wParam);
                    return 0;
                case WmClose:
                    // Fermer la fenêtre ne quitte pas l'agent : il reste dans la zone de notification.
                    if (_tokenOpen) CloseTokenPanel();
                    ShowWindow(window, SwHide);
                    KillTimer(window, RefreshTimer);
                    _onHidden();
                    return 0;
            }
        }
        catch (Exception e)
        {
            // Une exception ne peut pas remonter dans Windows, et une fenêtre en défaut ne doit pas
            // arrêter la synchronisation.
            _log.Error($"fenêtre : {e}");
        }

        return DefWindowProcW(window, message, wParam, lParam);
    }

    private static float X(IntPtr lParam) => (short)((long)lParam & 0xFFFF);

    private static float Y(IntPtr lParam) => (short)(((long)lParam >> 16) & 0xFFFF);

    private void Invalidate()
    {
        if (_window != 0) InvalidateRect(_window, 0, false);
    }

    private Zone ZoneAt(float x, float y)
    {
        // La dernière zone dessinée est au-dessus.
        for (var i = _zones.Count - 1; i >= 0; i--)
        {
            if (_zones[i].Bounds.Contains(x, y)) return _zones[i].Zone;
        }

        return Zone.None;
    }

    private void SetHover(Zone zone)
    {
        if (zone == _hover) return;
        _hover = zone;
        Invalidate();
    }

    private void OnMouseMove(float x, float y)
    {
        if (!_trackingMouse)
        {
            // Sans quoi le survol resterait affiché une fois le pointeur sorti de la fenêtre.
            var track = new TRACKMOUSEEVENT { cbSize = (uint)Marshal.SizeOf<TRACKMOUSEEVENT>(), dwFlags = 0x2, hwndTrack = _window };
            _trackingMouse = TrackMouseEvent(ref track);
        }

        if (_pressed == Zone.ScrollThumb)
        {
            var travel = _scrollTrack.Height - _thumbHeight;
            if (travel > 0) ScrollTo((y - _dragOffset - _scrollTrack.Y) / travel * (_contentHeight - _viewHeight));
            return;
        }

        SetHover(ZoneAt(x, y));
    }

    private void OnMouseDown(float x, float y)
    {
        _pressed = ZoneAt(x, y);
        _focusVisible = false;
        if (_pressed == Zone.None) return;
        if (_pressed == Zone.ScrollThumb)
        {
            var travel = _scrollTrack.Height - _thumbHeight;
            var thumbTop = _scrollTrack.Y + (travel > 0 ? _scroll / (_contentHeight - _viewHeight) * travel : 0);
            // Clic sur la piste, hors du curseur : il vient se centrer sous le pointeur.
            _dragOffset = y >= thumbTop && y < thumbTop + _thumbHeight ? y - thumbTop : _thumbHeight / 2;
            OnMouseMove(x, y);
        }
        else
        {
            _focus = _pressed;
        }

        SetCapture(_window);
        Invalidate();
    }

    private void OnMouseUp(float x, float y)
    {
        var pressed = _pressed;
        if (pressed == Zone.None) return;
        _pressed = Zone.None;
        ReleaseCapture();
        Invalidate();
        if (pressed != Zone.ScrollThumb && ZoneAt(x, y) == pressed) Activate(pressed);
    }

    private void OnKey(int key)
    {
        if (_tokenOpen)
        {
            OnTokenKey(key);
            return;
        }

        switch (key)
        {
            case VkTab:
                var step = GetKeyState(VkShift) < 0 ? -1 : 1;
                var order = FocusOrder.Where(zone => _zones.Exists(entry => entry.Zone == zone)).ToArray();
                if (order.Length == 0) break;
                var index = Array.IndexOf(order, _focus);
                _focus = order[index < 0 ? (step > 0 ? 0 : order.Length - 1) : (index + step + order.Length) % order.Length];
                _focusVisible = true;
                Invalidate();
                break;
            case VkReturn or VkSpace when _focusVisible && _focus != Zone.None:
                Activate(_focus);
                break;
            case VkF5:
                Activate(Zone.SyncNow);
                break;
            case VkEscape:
                PostMessageW(_window, WmClose, 0, 0);
                break;
            case VkUp:
                ScrollBy(-S(48));
                break;
            case VkDown:
                ScrollBy(S(48));
                break;
            case VkPrior:
                ScrollBy(-_viewHeight * 0.9f);
                break;
            case VkNext:
                ScrollBy(_viewHeight * 0.9f);
                break;
            case VkHome:
                ScrollTo(0);
                break;
            case VkEnd:
                ScrollTo(float.MaxValue);
                break;
        }
    }

    private bool Animating => MathF.Abs(_togglePosition - (_autostartOn ? 1 : 0)) > 0.001f;

    private void OnTimer(nuint timer)
    {
        switch (timer)
        {
            case AnimationTimer:
                var target = _autostartOn ? 1f : 0f;
                // Environ 140 ms d'un bord à l'autre.
                _togglePosition = target > _togglePosition ? MathF.Min(target, _togglePosition + 0.12f) : MathF.Max(target, _togglePosition - 0.12f);
                if (!Animating)
                {
                    _toggleMoving = false;
                    KillTimer(_window, AnimationTimer);
                }

                Invalidate();
                break;
            case RefreshTimer:
                // Les durées affichées (« il y a 3 min ») vieillissent, et une commande lancée
                // ailleurs a pu écrire dans le journal.
                Reload();
                Invalidate();
                break;
            case SyncTimeoutTimer:
                KillTimer(_window, SyncTimeoutTimer);
                _syncRequested = false;
                Invalidate();
                break;
        }
    }

    private void Activate(Zone zone)
    {
        switch (zone)
        {
            case Zone.Update:
                // La page Machines propose le téléchargement ; lancé, le nouvel exécutable prend la place.
                Task.Run(_commands.OpenMachines);
                break;
            case Zone.Autostart:
                ToggleAutostart();
                break;
            case Zone.SyncNow when !_syncRequested:
                _syncRequested = true;
                // La surveillance répond par un signalement ; à défaut, le bouton se libère seul.
                SetTimer(_window, SyncTimeoutTimer, 20_000, 0);
                _commands.SyncNow();
                break;
            case Zone.Token:
                OpenTokenPanel();
                break;
            case Zone.TokenPaste:
                // Le champ colle lui-même, à la place de ce qu'il contient.
                SendMessageW(_tokenEdit, EmSetSel, 0, -1);
                SendMessageW(_tokenEdit, WmPaste, 0, 0);
                FocusTokenEdit();
                break;
            case Zone.TokenMachines:
                Task.Run(_commands.OpenMachines);
                break;
            case Zone.TokenCancel:
                CloseTokenPanel();
                break;
            case Zone.TokenSave:
                SaveToken();
                break;
            case Zone.Dashboard:
                // Hors du fil de la fenêtre : lancer un navigateur peut prendre du temps.
                Task.Run(_commands.OpenDashboard);
                break;
            case Zone.LogFile:
                Task.Run(_commands.OpenLog);
                break;
            case Zone.Quit:
                _commands.Quit();
                break;
        }

        Invalidate();
    }

    private void ToggleAutostart()
    {
        try
        {
            if (_autostartOn) _autostart.Disable();
            else _autostart.Enable();
            _autostartOn = _autostart.IsEnabled;
            _log.Info(_autostartOn ? "démarrage automatique activé" : "démarrage automatique désactivé");
            _journal.Info(_autostartOn ? "Démarrage avec Windows activé." : "Démarrage avec Windows désactivé.");
        }
        catch (Exception e) when (e is UnauthorizedAccessException or IOException or InvalidOperationException or System.Security.SecurityException)
        {
            _journal.Failed($"Démarrage avec Windows inchangé : {e.Message}");
        }

        _entries = _journal.ReadLatest();
        _layoutWidth = -1;
        _toggleMoving = Animating;
        if (_toggleMoving) SetTimer(_window, AnimationTimer, 16, 0);
    }

    private void ScrollBy(float delta) => ScrollTo(_scroll + delta);

    private void ScrollTo(float position)
    {
        var clamped = Math.Clamp(position, 0, Math.Max(0, _contentHeight - _viewHeight));
        if (clamped == _scroll) return;
        _scroll = clamped;
        Invalidate();
    }

    // ---------------------------------------------------------------------------
    // Dessin
    // ---------------------------------------------------------------------------

    private float S(float value) => MathF.Round(value * _scale);

    private static int ColorRef(uint color) => (int)(((color & 0xFF) << 16) | (color & 0xFF00) | ((color >> 16) & 0xFF));

    private static uint WithAlpha(uint color, byte alpha) => (color & 0x00FFFFFF) | ((uint)alpha << 24);

    private void OnPaint(IntPtr window)
    {
        var dc = BeginPaint(window, out var paint);
        try
        {
            GetClientRect(window, out var client);
            if (client.Right <= 0 || client.Bottom <= 0 || _fonts is null) return;
            // Dessin hors écran puis copie d'un bloc : aucun scintillement.
            var memory = CreateCompatibleDC(dc);
            var bitmap = CreateCompatibleBitmap(dc, client.Right, client.Bottom);
            var previous = SelectObject(memory, bitmap);
            try
            {
                using (var canvas = new Canvas(memory)) Paint(canvas, _fonts, client.Right, client.Bottom);
                BitBlt(dc, 0, 0, client.Right, client.Bottom, memory, 0, 0, SrcCopy);
            }
            finally
            {
                SelectObject(memory, previous);
                DeleteObject(bitmap);
                DeleteDC(memory);
            }
        }
        finally
        {
            EndPaint(window, ref paint);
        }
    }

    private void Paint(Canvas canvas, Fonts fonts, float width, float height)
    {
        _zones.Clear();
        canvas.Fill(new RectF(0, 0, width, height), Ink);
        canvas.Fill(new RectF(0, 0, width, S(190)), HeaderTop, Ink);

        float left = S(24), right = width - S(24), contentWidth = right - left;

        // En-tête : icône, nom, version, état.
        canvas.Icon(_icon, left, S(22), S(40));
        var pillWidth = PaintStatus(canvas, fonts, right, S(28));
        var titleWidth = contentWidth - S(56) - pillWidth - S(16);
        canvas.Text("AltBoard Sync", fonts.Title, Bright, new RectF(left + S(56), S(18), titleWidth, S(28)), TextLayout.Middle | TextLayout.Ellipsis);
        PaintSubtitle(canvas, fonts, new RectF(left + S(56), S(46), titleWidth, S(18)));

        PaintAutostart(canvas, fonts, new RectF(left, S(88), contentWidth, S(78)));
        PaintTiles(canvas, fonts, new RectF(left, S(178), contentWidth, S(86)));
        PaintButtons(canvas, fonts, left, S(278), right);

        canvas.Text("Journal", fonts.Heading, Bright, new RectF(left, S(334), S(120), S(22)), TextLayout.Middle);
        canvas.Text("Chaque envoi, et ce qui a changé depuis le précédent", fonts.Small, Faint, new RectF(left + S(120), S(334), contentWidth - S(120), S(22)), TextLayout.Middle | TextLayout.Right | TextLayout.Ellipsis);
        PaintJournal(canvas, fonts, new RectF(left, S(364), contentWidth, height - S(364) - S(52)));

        // Pied : fermer la fenêtre ne quitte pas l'agent.
        var quitWidth = canvas.Measure("Quitter", fonts.SmallBold).Width + S(24);
        var quit = new RectF(right - quitWidth, height - S(42), quitWidth, S(30));
        _zones.Add((Zone.Quit, quit));
        if (_hover == Zone.Quit) canvas.FillRound(quit, S(8), _pressed == Zone.Quit ? Raised : RaisedHover);
        canvas.Text("Quitter", fonts.SmallBold, _hover == Zone.Quit ? Bright : Muted, quit, TextLayout.Middle | TextLayout.Center);
        PaintFocus(canvas, Zone.Quit, quit, S(8));
        canvas.Text(
            "Fermer cette fenêtre laisse la synchronisation active, dans la zone de notification.", fonts.Small, Faint,
            new RectF(left, height - S(42), contentWidth - quitWidth - S(12), S(30)), TextLayout.Middle | TextLayout.Ellipsis);

        if (_tokenOpen) PaintTokenPanel(canvas, fonts, width, height);
    }

    /// <summary>Version et nom du PC ; s'il y a lieu, le lien vers la version plus récente.</summary>
    private void PaintSubtitle(Canvas canvas, Fonts fonts, RectF area)
    {
        var subtitle = $"Version {AgentApp.Version}  ·  {_machine}";
        if (_update is null)
        {
            canvas.Text(subtitle, fonts.Small, Muted, area, TextLayout.Middle | TextLayout.Ellipsis);
            return;
        }

        var link = $"Mise à jour {_update} disponible";
        var linkWidth = Math.Min(canvas.Measure(link, fonts.SmallBold).Width, area.Width);
        var textWidth = Math.Max(0, area.Width - linkWidth - S(14));
        canvas.Text(subtitle, fonts.Small, Muted, area with { Width = textWidth }, TextLayout.Middle | TextLayout.Ellipsis);
        var x = area.X + Math.Min(canvas.Measure(subtitle, fonts.Small).Width, textWidth) + S(14);
        var bounds = new RectF(x - S(6), area.Y - S(3), linkWidth + S(12), area.Height + S(6));
        _zones.Add((Zone.Update, bounds));
        if (_hover == Zone.Update) canvas.FillRound(bounds, S(6), WithAlpha(Gold, 0x1F));
        canvas.Text(link, fonts.SmallBold, _hover == Zone.Update ? GoldHover : Gold, area with { X = x, Width = linkWidth }, TextLayout.Middle | TextLayout.Ellipsis);
        PaintFocus(canvas, Zone.Update, bounds, S(6));
    }

    /// <returns>Largeur de la pastille, pour que le titre s'arrête avant.</returns>
    private float PaintStatus(Canvas canvas, Fonts fonts, float right, float top)
    {
        var (label, color) = _syncRequested ? ("Synchronisation en cours…", Accent)
            : _failing != true ? ("Synchronisation active", Ok)
            : _retryAt is { } retryAt && retryAt > DateTimeOffset.UtcNow ? ($"En échec · nouvel essai à {retryAt.ToLocalTime():HH:mm}", Danger)
            : ("En échec", Danger);
        var width = canvas.Measure(label, fonts.SmallBold).Width + S(40);
        var pill = new RectF(right - width, top, width, S(28));
        canvas.FillRound(pill, S(14), WithAlpha(color, 0x26));
        canvas.StrokeRound(pill, S(14), WithAlpha(color, 0x55));
        canvas.FillCircle(pill.X + S(16), pill.Y + S(14), S(4), color);
        canvas.Text(label, fonts.SmallBold, color, new RectF(pill.X + S(28), pill.Y, width - S(36), pill.Height), TextLayout.Middle);
        return width;
    }

    private void PaintAutostart(Canvas canvas, Fonts fonts, RectF card)
    {
        _zones.Add((Zone.Autostart, card));
        var hovered = _hover == Zone.Autostart;
        canvas.FillRound(card, S(14), hovered ? Raised : Surface);
        canvas.StrokeRound(card, S(14), hovered ? LineStrong : Line);

        var textWidth = card.Width - S(20) - S(96);
        canvas.Text("Démarrage avec Windows", fonts.Heading, Bright, new RectF(card.X + S(20), card.Y + S(16), textWidth, S(22)), TextLayout.Middle | TextLayout.Ellipsis);
        var description = _autostartOn
            ? "Activé : la synchronisation se lance en arrière-plan à l'ouverture de session."
            : "Désactivé : la synchronisation ne tourne que tant que cette application est ouverte.";
        canvas.Text(description, fonts.Small, Muted, new RectF(card.X + S(20), card.Y + S(42), textWidth, S(20)), TextLayout.Middle | TextLayout.Ellipsis);

        // Interrupteur : la piste passe du gris à l'or, le bouton glisse.
        var track = new RectF(card.Right - S(20) - S(46), card.Y + (card.Height - S(26)) / 2, S(46), S(26));
        canvas.FillRound(track, S(13), Blend(0xFF2A344B, Gold, _togglePosition));
        var knob = S(10);
        var travel = track.Width - S(6) - knob * 2;
        canvas.FillCircle(track.X + S(3) + knob + travel * _togglePosition, track.Y + track.Height / 2, knob, Blend(0xFFB4BED3, OnGold, _togglePosition));
        PaintFocus(canvas, Zone.Autostart, card, S(14));
    }

    private void PaintTiles(Canvas canvas, Fonts fonts, RectF area)
    {
        var gap = S(12);
        var tileWidth = (area.Width - gap * 2) / 3;
        var lastSync = _entries.FirstOrDefault(e => e.Kind == JournalEntry.Synced);

        string value, detail;
        if (lastSync is null)
        {
            (value, detail) = ("Jamais", "aucun envoi pour l'instant");
        }
        else
        {
            var at = lastSync.At.ToLocalTime().DateTime;
            var today = DateTime.Now.Date;
            (value, detail) = at.Date == today ? ($"{at:HH:mm}", Relative(DateTime.Now - at))
                : at.Date == today.AddDays(-1) ? ("Hier", $"à {at:HH:mm}")
                : ($"{at.Day} {Months[at.Month - 1]}", $"à {at:HH:mm}");
        }

        // Textes courts : ils tiennent encore à la largeur minimale de la fenêtre.
        PaintTile(canvas, fonts, new RectF(area.X, area.Y, tileWidth, area.Height), "DERNIER ENVOI", value, detail, Muted);

        var changed = lastSync?.Changes.Count ?? 0;
        PaintTile(
            canvas, fonts, new RectF(area.X + tileWidth + gap, area.Y, tileWidth, area.Height), "PERSONNAGES",
            lastSync?.Characters is { } characters ? $"{characters}" : "—",
            lastSync is null ? "en attente d'un envoi" : changed == 0 ? "aucun changement" : changed == 1 ? "1 modifié" : $"{changed} modifiés",
            Muted);

        var (tokenLabel, tokenColor) = _token switch
        {
            TokenState.Present when _tokenRejected => ("jeton refusé", Danger),
            TokenState.Present => ("jeton enregistré", Ok),
            TokenState.Absent => ("jeton absent", Danger),
            _ => ("jeton illisible", Danger),
        };
        PaintTile(canvas, fonts, new RectF(area.X + (tileWidth + gap) * 2, area.Y, tileWidth, area.Height), "SERVEUR", _server, tokenLabel, tokenColor, fonts.Heading);
    }

    private void PaintTile(Canvas canvas, Fonts fonts, RectF tile, string label, string value, string detail, uint detailColor, IntPtr? valueFont = null)
    {
        canvas.FillRound(tile, S(14), Surface);
        canvas.StrokeRound(tile, S(14), Line);
        var text = new RectF(tile.X + S(16), tile.Y, tile.Width - S(32), 0);
        canvas.Text(label, fonts.Label, Faint, text with { Y = tile.Y + S(12), Height = S(16) }, TextLayout.Middle | TextLayout.Ellipsis);
        canvas.Text(value, valueFont ?? fonts.Value, Bright, text with { Y = tile.Y + S(30), Height = S(28) }, TextLayout.Middle | TextLayout.Ellipsis);
        canvas.Text(detail, fonts.Small, detailColor, text with { Y = tile.Y + S(58), Height = S(18) }, TextLayout.Middle | TextLayout.Ellipsis);
    }

    private void PaintButtons(Canvas canvas, Fonts fonts, float left, float top, float right)
    {
        var x = left;
        x = PaintButton(canvas, fonts, Zone.SyncNow, x, top, GlyphSync, _syncRequested ? "Synchronisation…" : "Synchroniser maintenant", primary: true) + S(10);
        x = PaintButton(canvas, fonts, Zone.Token, x, top, GlyphKey, _token == TokenState.Present ? "Jeton" : "Saisir le jeton", primary: false) + S(10);
        x = PaintButton(canvas, fonts, Zone.Dashboard, x, top, GlyphGlobe, "Tableau de bord", primary: false) + S(10);
        if (x + S(150) <= right) PaintButton(canvas, fonts, Zone.LogFile, x, top, GlyphDocument, "Fichier journal", primary: false);
    }

    /// <param name="glyph">Null : bouton sans pictogramme.</param>
    private float ButtonWidth(Canvas canvas, Fonts fonts, string? glyph, string label) =>
        S(16) + (glyph is not null && fonts.Glyph != 0 ? S(24) : 0) + canvas.Measure(label, fonts.BodyBold).Width + S(18);

    /// <returns>Bord droit du bouton.</returns>
    private float PaintButton(Canvas canvas, Fonts fonts, Zone zone, float x, float top, string? glyph, string label, bool primary)
    {
        var button = new RectF(x, top, ButtonWidth(canvas, fonts, glyph, label), S(38));
        PaintButton(canvas, fonts, zone, button, glyph, label, primary);
        return button.Right;
    }

    private void PaintButton(Canvas canvas, Fonts fonts, Zone zone, RectF button, string? glyph, string label, bool primary)
    {
        var glyphWidth = glyph is not null && fonts.Glyph != 0 ? S(24) : 0;
        float x = button.X, top = button.Y, width = button.Width;
        _zones.Add((zone, button));

        bool hovered = _hover == zone, pressed = _pressed == zone && hovered, busy = zone == Zone.SyncNow && _syncRequested;
        uint foreground;
        if (primary)
        {
            canvas.FillRound(button, S(10), busy ? WithAlpha(Gold, 0x80) : pressed ? GoldPressed : hovered ? GoldHover : Gold);
            foreground = OnGold;
        }
        else
        {
            canvas.FillRound(button, S(10), pressed ? Surface : hovered ? RaisedHover : Raised);
            canvas.StrokeRound(button, S(10), hovered ? LineStrong : Line);
            foreground = Bright;
        }

        if (glyph is not null && fonts.Glyph != 0) canvas.Text(glyph, fonts.Glyph, foreground, new RectF(x + S(14), top, S(20), button.Height), TextLayout.Middle | TextLayout.Center);
        canvas.Text(label, fonts.BodyBold, foreground, new RectF(x + S(16) + glyphWidth, top, width - glyphWidth - S(24), button.Height), TextLayout.Middle);
        PaintFocus(canvas, zone, button, S(10));
    }

    // ---------------------------------------------------------------------------
    // Jeton
    // ---------------------------------------------------------------------------

    /// <summary>Emplacements du panneau du jeton. Calculés sans surface de dessin : ils placent aussi le champ.</summary>
    private (RectF Card, RectF Field, RectF Edit) LayoutTokenPanel(float width, float height)
    {
        float cardWidth = MathF.Min(S(520), width - S(48)), cardHeight = S(252);
        var card = new RectF(MathF.Round((width - cardWidth) / 2), MathF.Max(S(16), MathF.Round((height - cardHeight) / 2) - S(16)), cardWidth, cardHeight);
        // À droite du champ, la place du bouton « Coller ».
        var field = new RectF(card.X + S(24), card.Y + S(102), card.Width - S(48) - S(112), S(40));
        var edit = new RectF(field.X + S(14), field.Y + S(9), field.Width - S(24), S(22));
        return (card, field, edit);
    }

    private void PaintTokenPanel(Canvas canvas, Fonts fonts, float width, float height)
    {
        // Ce qui est derrière le voile cesse de répondre.
        _zones.Clear();
        canvas.Fill(new RectF(0, 0, width, height), WithAlpha(Ink, 0xC8));
        var (card, field, _) = LayoutTokenPanel(width, height);
        canvas.FillRound(card, S(16), Surface);
        canvas.StrokeRound(card, S(16), LineStrong);

        float left = card.X + S(24), inner = card.Width - S(48), right = left + inner;
        canvas.Text("Jeton d'agent", fonts.Heading, Bright, new RectF(left, card.Y + S(22), inner, S(24)), TextLayout.Middle);
        // Espace insécable : le deux-points ne passe pas seul à la ligne.
        var description = _tokenRejected
            ? "Le serveur refuse le jeton enregistré : révoqué, ou lié à un autre PC. Créez-en un nouveau sur la page Machines du tableau de bord, puis collez-le ici."
            : "Créez un jeton sur la page Machines du tableau de bord, puis collez-le ici. Un jeton par PC : il se lie au premier qui l'utilise.";
        if (_token == TokenState.Present && !_tokenRejected) description += " Celui qui est enregistré sera remplacé.";
        canvas.Text(description, fonts.Small, Muted, new RectF(left, card.Y + S(54), inner, S(38)), TextLayout.Wrap);

        canvas.FillRound(field, S(10), Ink);
        canvas.StrokeRound(field, S(10), _tokenError is not null ? Danger : _tokenFieldFocused ? Accent : LineStrong, _tokenFieldFocused ? S(2) : 1);
        var pasteWidth = ButtonWidth(canvas, fonts, GlyphPaste, "Coller");
        PaintButton(canvas, fonts, Zone.TokenPaste, new RectF(right - pasteWidth, field.Y + S(1), pasteWidth, S(38)), GlyphPaste, "Coller", primary: false);
        canvas.Text(
            _tokenError ?? "Chiffré pour votre session Windows ; il n'apparaît dans aucun journal.", fonts.Small, _tokenError is null ? Faint : Danger,
            new RectF(left, field.Bottom + S(8), inner, S(18)), TextLayout.Middle | TextLayout.Ellipsis);

        var top = card.Y + S(190);
        PaintButton(canvas, fonts, Zone.TokenMachines, left, top, GlyphGlobe, "Créer un jeton", primary: false);
        float saveWidth = ButtonWidth(canvas, fonts, null, "Enregistrer"), cancelWidth = ButtonWidth(canvas, fonts, null, "Annuler");
        PaintButton(canvas, fonts, Zone.TokenCancel, new RectF(right - saveWidth - S(10) - cancelWidth, top, cancelWidth, S(38)), null, "Annuler", primary: false);
        PaintButton(canvas, fonts, Zone.TokenSave, new RectF(right - saveWidth, top, saveWidth, S(38)), null, "Enregistrer", primary: true);
    }

    private void OpenTokenPanel()
    {
        if (_window == 0 || _fonts is null) return;
        if (_tokenEdit == 0)
        {
            _tokenEdit = CreateWindowExW(0, "EDIT", "", WsChild | EsAutoHScroll | EsPassword, 0, 0, 0, 0, _window, 0, GetModuleHandleW(null), 0);
            SendMessageW(_tokenEdit, WmSetFont, _fonts.Body, 0);
            SendMessageW(_tokenEdit, EmSetPasswordChar, (IntPtr)'●', 0);
            SendMessageW(_tokenEdit, EmSetLimitText, 200, 0);
            // Entrée, Échap et Tab sont des touches du panneau, pas du champ.
            _tokenEditPrevious = SetWindowLongPtrW(_tokenEdit, GwlpWndProc, Marshal.GetFunctionPointerForDelegate(_tokenEditProcedure));
        }

        _tokenOpen = true;
        _hover = _pressed = Zone.None;
        SetWindowTextW(_tokenEdit, "");
        _tokenError = null;
        PlaceTokenEdit();
        ShowWindow(_tokenEdit, SwShow);
        FocusTokenEdit();
        Invalidate();
    }

    private void CloseTokenPanel()
    {
        _tokenOpen = false;
        _focus = Zone.None;
        _focusVisible = false;
        SetFocus(_window);
        ShowWindow(_tokenEdit, SwHide);
        // Rien de saisi ne reste dans un champ que l'on ne voit plus.
        SetWindowTextW(_tokenEdit, "");
        Invalidate();
    }

    private void PlaceTokenEdit()
    {
        if (_tokenEdit == 0 || !GetClientRect(_window, out var client)) return;
        var edit = LayoutTokenPanel(client.Right, client.Bottom).Edit;
        SetWindowPos(_tokenEdit, 0, (int)edit.X, (int)edit.Y, (int)edit.Width, (int)edit.Height, SwpNoZOrder | SwpNoActivate);
    }

    private void FocusTokenEdit()
    {
        _focus = Zone.None;
        _focusVisible = false;
        SetFocus(_tokenEdit);
    }

    private void SaveToken()
    {
        var text = new char[GetWindowTextLengthW(_tokenEdit) + 1];
        var token = new string(text, 0, GetWindowTextW(_tokenEdit, text, text.Length)).Trim();
        Array.Clear(text);
        _tokenError = token.Length == 0 ? "Collez d'abord le jeton créé sur la page Machines."
            : !TokenStore.IsWellFormed(token) ? "Ce n'est pas un jeton : il commence par « wab_ » et compte 47 caractères."
            : null;
        if (_tokenError is null)
        {
            try
            {
                new TokenStore(_homeDirectory).Save(token);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException)
            {
                _log.Error($"jeton non enregistré : {e.Message}");
                _tokenError = $"Jeton non enregistré : {e.Message}";
            }
        }

        if (_tokenError is not null)
        {
            FocusTokenEdit();
            Invalidate();
            return;
        }

        _log.Info("jeton d'agent enregistré depuis la fenêtre");
        _journal.Info("Jeton d'agent enregistré.");
        _tokenRejected = _tokenRejectedAsked = false;
        CloseTokenPanel();
        Reload();
        // Le jeton vient d'arriver : la surveillance n'attend pas son prochain essai.
        Activate(Zone.SyncNow);
    }

    private void OnTokenKey(int key)
    {
        var inField = GetFocus() == _tokenEdit;
        switch (key)
        {
            case VkEscape:
                CloseTokenPanel();
                break;
            case VkReturn when inField:
                SaveToken();
                break;
            case VkReturn or VkSpace when _focusVisible && _focus != Zone.None:
                Activate(_focus);
                break;
            case VkTab:
                // Le champ ouvre la boucle : lui seul porte le focus clavier de Windows.
                var count = TokenFocusOrder.Length + 1;
                var current = inField ? 0 : Array.IndexOf(TokenFocusOrder, _focus) + 1;
                var next = (current + (GetKeyState(VkShift) < 0 ? -1 : 1) + count) % count;
                if (next == 0)
                {
                    FocusTokenEdit();
                }
                else
                {
                    _focus = TokenFocusOrder[next - 1];
                    _focusVisible = true;
                    SetFocus(_window);
                }

                Invalidate();
                break;
        }
    }

    /// <summary>Procédure du champ du jeton, placée devant celle de Windows.</summary>
    private IntPtr HandleTokenEdit(IntPtr window, uint message, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            switch (message)
            {
                case WmKeyDown when (int)wParam is VkReturn or VkEscape or VkTab:
                    OnTokenKey((int)wParam);
                    return 0;
                // Sans quoi le champ émet le bip des touches qu'il refuse.
                case WmChar when (int)wParam is '\r' or '\t' or 0x1B:
                    return 0;
            }
        }
        catch (Exception e)
        {
            _log.Error($"champ du jeton : {e}");
        }

        return CallWindowProcW(_tokenEditPrevious, window, message, wParam, lParam);
    }

    private void PaintFocus(Canvas canvas, Zone zone, RectF bounds, float radius)
    {
        // Visible seulement quand on navigue au clavier.
        if (!_focusVisible || _focus != zone) return;
        var ring = new RectF(bounds.X - S(3), bounds.Y - S(3), bounds.Width + S(6), bounds.Height + S(6));
        canvas.StrokeRound(ring, radius + S(3), Accent, S(2));
    }

    // ---------------------------------------------------------------------------
    // Journal
    // ---------------------------------------------------------------------------

    private void PaintJournal(Canvas canvas, Fonts fonts, RectF panel)
    {
        canvas.FillRound(panel, S(14), Surface);
        canvas.StrokeRound(panel, S(14), Line);
        var view = new RectF(panel.X + 1, panel.Y + S(6), panel.Width - 2, panel.Height - S(12));
        _viewHeight = view.Height;
        _scrollTrack = default;

        if (_entries.Count == 0)
        {
            _contentHeight = 0;
            canvas.Text("Aucune synchronisation pour l'instant", fonts.Heading, Muted, new RectF(view.X, view.Y + view.Height / 2 - S(30), view.Width, S(24)), TextLayout.Middle | TextLayout.Center);
            canvas.Text(
                "Le jeu écrit ses données à la déconnexion du personnage ou sur /reload : l'envoi suit quelques secondes après.",
                fonts.Small, Faint, new RectF(view.X + S(40), view.Y + view.Height / 2, view.Width - S(80), S(40)), TextLayout.Wrap | TextLayout.Center);
            return;
        }

        if (_layoutWidth != view.Width) LayoutJournal(canvas, fonts, view.Width);
        _scroll = Math.Clamp(_scroll, 0, Math.Max(0, _contentHeight - _viewHeight));

        canvas.Clip(view);
        foreach (var row in _rows)
        {
            var top = view.Y + row.Top - _scroll;
            if (top + row.Height < view.Y || top > view.Bottom) continue;
            if (row.DayLabel is { } day)
                canvas.Text(day, fonts.Label, Faint, new RectF(view.X + S(20), top + row.Height - S(24), view.Width - S(40), S(18)), TextLayout.Middle);
            else
                PaintEntry(canvas, fonts, row, view.X, top, view.Width);
        }

        canvas.Unclip();

        if (_contentHeight <= _viewHeight) return;
        _scrollTrack = new RectF(panel.Right - S(11), view.Y + S(4), S(5), view.Height - S(8));
        _thumbHeight = Math.Max(S(32), _scrollTrack.Height * _viewHeight / _contentHeight);
        var thumbTop = _scrollTrack.Y + _scroll / (_contentHeight - _viewHeight) * (_scrollTrack.Height - _thumbHeight);
        var active = _hover == Zone.ScrollThumb || _pressed == Zone.ScrollThumb;
        canvas.FillRound(new RectF(_scrollTrack.X, thumbTop, _scrollTrack.Width, _thumbHeight), S(3), active ? 0x66FFFFFFu : 0x33FFFFFFu);
        // Zone de saisie plus large que le trait : il resterait difficile à attraper.
        _zones.Add((Zone.ScrollThumb, new RectF(_scrollTrack.X - S(8), _scrollTrack.Y, S(19), _scrollTrack.Height)));
    }

    private float TextLeft => S(96);

    private float TextWidth(float viewWidth) => viewWidth - TextLeft - S(28);

    /// <summary>Hauteur de chaque ligne pour cette largeur ; refait quand le journal ou la fenêtre change.</summary>
    private void LayoutJournal(Canvas canvas, Fonts fonts, float viewWidth)
    {
        _rows.Clear();
        _layoutWidth = viewWidth;
        var textWidth = TextWidth(viewWidth);
        var today = DateTime.Now.Date;
        DateTime? currentDay = null;
        float y = 0;
        foreach (var entry in _entries)
        {
            var day = entry.At.ToLocalTime().Date;
            if (day != currentDay)
            {
                currentDay = day;
                var headerHeight = _rows.Count == 0 ? S(32) : S(42);
                _rows.Add(new Row(y, headerHeight, DayLabel(day, today), null, 0));
                y += headerHeight;
            }

            var height = S(10) + S(20);
            if (entry.Kind != JournalEntry.Info) height += canvas.Measure(entry.Message, fonts.Small, textWidth, TextLayout.Wrap).Height + S(2);
            float nameWidth = 0;
            if (entry.Changes.Count > 0)
            {
                nameWidth = Math.Min(S(170), entry.Changes.Max(c => canvas.Measure(c.Name, fonts.SmallBold).Width));
                height += S(6);
                foreach (var change in entry.Changes)
                    height += canvas.Measure(Details(change), fonts.Small, textWidth - nameWidth - S(14), TextLayout.Wrap).Height + S(5);
            }

            height += S(10);
            _rows.Add(new Row(y, height, null, entry, nameWidth));
            y += height;
        }

        _contentHeight = y + S(4);
    }

    private static string Details(CharacterChange change) => string.Join("  ·  ", change.Details);

    private void PaintEntry(Canvas canvas, Fonts fonts, Row row, float left, float top, float viewWidth)
    {
        var entry = row.Entry!;
        var (title, color) = entry.Kind switch
        {
            JournalEntry.Synced => ("Synchronisation réussie", Ok),
            JournalEntry.Failed => ("Échec de la synchronisation", Danger),
            _ => (entry.Message, Faint),
        };
        var textLeft = left + TextLeft;
        var textWidth = TextWidth(viewWidth);

        canvas.Text($"{entry.At.ToLocalTime():HH:mm}", fonts.Small, Muted, new RectF(left + S(20), top + S(10), S(44), S(20)), TextLayout.Middle);
        canvas.FillCircle(left + S(78), top + S(20), S(8), WithAlpha(color, 0x2E));
        canvas.FillCircle(left + S(78), top + S(20), S(4), color);

        var info = entry.Kind == JournalEntry.Info;
        canvas.Text(title, info ? fonts.Body : fonts.BodyBold, info ? Muted : Bright, new RectF(textLeft, top + S(10), textWidth, S(20)), TextLayout.Middle | TextLayout.Ellipsis);
        var y = top + S(30);
        if (!info)
        {
            var messageHeight = canvas.Measure(entry.Message, fonts.Small, textWidth, TextLayout.Wrap).Height;
            // Les messages du serveur commencent souvent par une minuscule.
            var message = entry.Message.Length == 0 ? "" : char.ToUpperInvariant(entry.Message[0]) + entry.Message[1..];
            canvas.Text(message, fonts.Small, Muted, new RectF(textLeft, y, textWidth, messageHeight), TextLayout.Wrap);
            y += messageHeight + S(2);
        }

        if (entry.Changes.Count > 0)
        {
            y += S(6);
            var detailsLeft = textLeft + row.NameWidth + S(14);
            var detailsWidth = textWidth - row.NameWidth - S(14);
            foreach (var change in entry.Changes)
            {
                var details = Details(change);
                var detailsHeight = canvas.Measure(details, fonts.Small, detailsWidth, TextLayout.Wrap).Height;
                canvas.Text(change.Name, fonts.SmallBold, Gold, new RectF(textLeft, y, row.NameWidth, detailsHeight), TextLayout.Ellipsis);
                canvas.Text(details, fonts.Small, Bright, new RectF(detailsLeft, y, detailsWidth, detailsHeight), TextLayout.Wrap);
                y += detailsHeight + S(5);
            }
        }

        canvas.Fill(new RectF(textLeft, top + row.Height - 1, textWidth, 1), Line);
    }

    // Écrits à la main : l'agent est publié sans données de culture (InvariantGlobalization).

    private static string DayLabel(DateTime day, DateTime today)
    {
        if (day == today) return "AUJOURD'HUI";
        if (day == today.AddDays(-1)) return "HIER";
        var label = $"{Days[(int)day.DayOfWeek]} {day.Day}{(day.Day == 1 ? "er" : "")} {Months[day.Month - 1]}";
        return (day.Year == today.Year ? label : $"{label} {day.Year}").ToUpperInvariant();
    }

    private static string Relative(TimeSpan elapsed) =>
        elapsed.TotalSeconds < 60 ? "à l'instant"
        : elapsed.TotalMinutes < 60 ? $"il y a {(int)elapsed.TotalMinutes} min"
        : $"il y a {(int)elapsed.TotalHours} h";

    private static uint Blend(uint from, uint to, float t)
    {
        uint Channel(int shift) => (uint)(((from >> shift) & 0xFF) + (((to >> shift) & 0xFF) - (float)((from >> shift) & 0xFF)) * t);
        return 0xFF000000 | (Channel(16) << 16) | (Channel(8) << 8) | Channel(0);
    }

    /// <summary>Polices à l'échelle de l'écran : Segoe UI, et la police d'icônes de Windows si elle existe.</summary>
    private sealed class Fonts : IDisposable
    {
        private readonly List<IntPtr> _created = [];

        public IntPtr Title { get; }
        public IntPtr Heading { get; }
        public IntPtr Value { get; }
        public IntPtr Body { get; }
        public IntPtr BodyBold { get; }
        public IntPtr Small { get; }
        public IntPtr SmallBold { get; }
        public IntPtr Label { get; }

        /// <summary>Zéro si Windows n'a aucune police d'icônes : les boutons se passent alors de pictogramme.</summary>
        public IntPtr Glyph { get; }

        public Fonts(float scale)
        {
            IntPtr Create(float size, int weight, string face = "Segoe UI")
            {
                // Hauteur négative : hauteur des caractères, en pixels. Qualité 5 : ClearType.
                var font = CreateFontW(-(int)MathF.Round(size * scale), 0, 0, 0, weight, 0, 0, 0, 1, 0, 0, 5, 0, face);
                _created.Add(font);
                return font;
            }

            Title = Create(21, 600);
            Heading = Create(14.5f, 600);
            Value = Create(20, 600);
            Body = Create(13.5f, 400);
            BodyBold = Create(13.5f, 600);
            Small = Create(12.5f, 400);
            SmallBold = Create(12.5f, 600);
            Label = Create(11, 600);

            // Windows 11, puis Windows 10. Une police absente est remplacée en silence par une
            // autre : seul le nom réellement obtenu le dit.
            var dc = CreateCompatibleDC(0);
            foreach (var face in (string[])["Segoe Fluent Icons", "Segoe MDL2 Assets"])
            {
                var font = Create(15, 400, face);
                var previous = SelectObject(dc, font);
                var name = new char[64];
                var length = GetTextFaceW(dc, name.Length, name);
                SelectObject(dc, previous);
                if (new string(name, 0, Math.Max(0, length - 1)) != face) continue;
                Glyph = font;
                break;
            }

            DeleteDC(dc);
        }

        public void Dispose()
        {
            foreach (var font in _created) DeleteObject(font);
        }
    }
}
