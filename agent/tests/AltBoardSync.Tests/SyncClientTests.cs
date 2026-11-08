using System.Diagnostics;
using System.Net;
using System.Text;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Tests;

public class SyncClientTests
{
    private static readonly Uri Endpoint = new("https://wow.example.test/api/sync");

    private static readonly SyncPayload Document = new(
        SyncPayload.CurrentSchemaVersion, "0.0.0-test", DateTimeOffset.UnixEpoch, new MachinePayload(Guid.Parse("00000000-0000-4000-8000-000000000001"), "PC-TEST", null), []);

    /// <summary>Répond aussitôt par des en-têtes 200, puis sert le corps donné.</summary>
    private sealed class HeadersThen(Stream body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(body) });
    }

    /// <summary>Corps qui ne livre jamais un octet : un serveur muet après ses en-têtes.</summary>
    private sealed class SilentStream : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return 0;
        }

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    /// <summary>Corps coupé net après quelques octets.</summary>
    private sealed class BrokenStream : Stream
    {
        private bool _sent;

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            if (_sent) throw new IOException("connexion réinitialisée par le pair");
            _sent = true;
            var start = "{\"runId\":"u8;
            start.CopyTo(buffer.Span);
            return ValueTask.FromResult(start.Length);
        }

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    [Fact]
    public async Task A_server_silent_after_its_headers_ends_in_a_timeout_not_a_hang()
    {
        using var http = new HttpClient(new HeadersThen(new SilentStream())) { Timeout = TimeSpan.FromMilliseconds(300) };
        var elapsed = Stopwatch.StartNew();

        var outcome = await new SyncClient(http, "0.0.0-test").SendAsync(Endpoint, "wab_test", Document);

        Assert.False(outcome.Succeeded);
        Assert.Equal("Délai d'attente du serveur dépassé", outcome.Error);
        Assert.True(elapsed.Elapsed < TimeSpan.FromSeconds(10), $"rendu après {elapsed.Elapsed}");
    }

    [Fact]
    public async Task A_connection_cut_while_reading_the_answer_is_an_error_not_an_exception()
    {
        using var http = new HttpClient(new HeadersThen(new BrokenStream()));

        var outcome = await new SyncClient(http, "0.0.0-test").SendAsync(Endpoint, "wab_test", Document);

        Assert.False(outcome.Succeeded);
        Assert.StartsWith("Connexion coupée pendant la réponse du serveur", outcome.Error);
    }

    [Fact]
    public async Task Cancelling_on_purpose_still_cancels()
    {
        using var http = new HttpClient(new HeadersThen(new SilentStream()));
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => new SyncClient(http, "0.0.0-test").SendAsync(Endpoint, "wab_test", Document, cancellation.Token));
    }

    [Fact]
    public async Task A_complete_answer_is_read_as_before()
    {
        var body = new MemoryStream(Encoding.UTF8.GetBytes(
            """{"runId":7,"status":"partial","accountsReceived":0,"charactersReceived":0,"charactersCreated":0,"charactersUpdated":0,"charactersUnchanged":0,"charactersStale":0,"snapshotsCreated":0,"errors":[]}"""));
        using var http = new HttpClient(new HeadersThen(body));

        var outcome = await new SyncClient(http, "0.0.0-test").SendAsync(Endpoint, "wab_test", Document);

        Assert.True(outcome.Succeeded, outcome.Error);
        Assert.Equal(7, outcome.Response!.RunId);
    }
}
