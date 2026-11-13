using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
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

    /// <summary>Répond par le statut, le corps et l'en-tête Retry-After donnés.</summary>
    private sealed class Replies(HttpStatusCode status, string body, RetryConditionHeaderValue? retryAfter = null) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            response.Headers.RetryAfter = retryAfter;
            return Task.FromResult(response);
        }
    }

    private static Task<SyncOutcome> Send(HttpStatusCode status, string body, RetryConditionHeaderValue? retryAfter = null)
    {
        var http = new HttpClient(new Replies(status, body, retryAfter));
        return new SyncClient(http, "0.0.0-test").SendAsync(Endpoint, "wab_test", Document);
    }

    [Fact]
    public async Task The_version_served_by_the_site_is_read_from_the_answer()
    {
        var outcome = await Send(HttpStatusCode.OK, """{"runId":7,"status":"success","errors":[],"latestAgentVersion":"0.9.0"}""");

        Assert.True(outcome.Succeeded, outcome.Error);
        Assert.Equal("0.9.0", outcome.Response!.LatestAgentVersion);
        Assert.Null(outcome.Response.Issues);
        Assert.Null(outcome.RetryAfter);
    }

    [Fact]
    public async Task A_refusal_lists_at_most_three_fields_then_counts_the_others()
    {
        var outcome = await Send(HttpStatusCode.UnprocessableContent,
            """{"error":"Document de synchronisation invalide.","code":"invalid_payload","issues":[{"path":"a","code":"x"},{"path":"b","code":"x"},{"path":"c","code":"x"},{"path":"d","code":"x"},{"path":"e","code":"x"}]}""");

        Assert.False(outcome.Succeeded);
        Assert.False(outcome.TokenRejected);
        Assert.Equal("Document de synchronisation invalide. Champs en cause : a (x), b (x), c (x) et 2 autres. Mettez l'agent à jour si le refus persiste.", outcome.Error);
    }

    [Fact]
    public async Task A_date_ahead_of_the_server_is_not_blamed_on_the_agent_version()
    {
        var outcome = await Send(HttpStatusCode.UnprocessableContent,
            """{"error":"Date postérieure à l'heure du serveur : l'horloge de ce PC est-elle en avance ?","code":"future_timestamp","issues":[{"path":"generatedAt","code":"future_timestamp"}]}""");

        Assert.Equal("Date postérieure à l'heure du serveur : l'horloge de ce PC est-elle en avance ?. Champs en cause : generatedAt (future_timestamp).", outcome.Error);
    }

    [Fact]
    public async Task A_document_too_large_without_details_still_suggests_the_update()
    {
        var outcome = await Send(HttpStatusCode.RequestEntityTooLarge, """{"error":"Document trop volumineux.","code":"payload_too_large"}""");

        Assert.Equal("Document trop volumineux. Mettez l'agent à jour si le refus persiste.", outcome.Error);
    }

    [Fact]
    public async Task A_rejected_token_says_what_to_do()
    {
        var outcome = await Send(HttpStatusCode.Unauthorized, """{"error":"Jeton d'agent absent, invalide ou révoqué.","code":"unauthorized"}""");

        Assert.True(outcome.TokenRejected);
        Assert.Equal("Jeton d'agent absent, invalide ou révoqué. Saisissez un nouveau jeton, créé dans la page Machines.", outcome.Error);
    }

    [Fact]
    public async Task A_token_bound_to_another_pc_is_a_rejected_token_too()
    {
        var outcome = await Send(HttpStatusCode.Forbidden, """{"error":"Ce jeton est déjà lié à une autre machine.","code":"token_machine_mismatch"}""");

        Assert.True(outcome.TokenRejected);
        Assert.Equal("Ce jeton est déjà lié à une autre machine. Saisissez un nouveau jeton, créé dans la page Machines.", outcome.Error);
        // Un autre refus 403 (proxy, pare-feu) ne met pas le jeton en cause.
        Assert.False((await Send(HttpStatusCode.Forbidden, "<html>Forbidden</html>")).TokenRejected);
    }

    [Fact]
    public async Task The_wait_asked_by_the_server_is_read_and_bounded_to_an_hour()
    {
        Assert.Equal(TimeSpan.FromSeconds(30), (await Send(HttpStatusCode.ServiceUnavailable, "{}", new RetryConditionHeaderValue(TimeSpan.FromSeconds(30)))).RetryAfter);
        Assert.Equal(TimeSpan.FromHours(1), (await Send(HttpStatusCode.TooManyRequests, "{}", new RetryConditionHeaderValue(TimeSpan.FromHours(5)))).RetryAfter);
        var inTwoMinutes = (await Send(HttpStatusCode.ServiceUnavailable, "{}", new RetryConditionHeaderValue(DateTimeOffset.UtcNow.AddMinutes(2)))).RetryAfter;
        Assert.InRange(inTwoMinutes!.Value, TimeSpan.FromSeconds(90), TimeSpan.FromMinutes(2));
        Assert.Null((await Send(HttpStatusCode.ServiceUnavailable, "{}", new RetryConditionHeaderValue(DateTimeOffset.UtcNow.AddMinutes(-2)))).RetryAfter);
    }

    [Fact]
    public async Task A_proxy_error_page_keeps_the_http_status_as_message()
    {
        var outcome = await Send(HttpStatusCode.BadGateway, "<html>Bad gateway</html>");

        Assert.Equal("HTTP 502 Bad Gateway", outcome.Error);
    }
}
