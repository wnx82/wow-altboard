using AltBoardSync.Core.App;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Tests;

public class PayloadLimitsTests
{
    [Fact]
    public void At_most_fifty_warnings_the_last_one_counting_those_left_out()
    {
        var warnings = PayloadLimits.Warnings(Enumerable.Range(1, 61).Select(i => $"avertissement {i}"));

        Assert.Equal(PayloadLimits.MaxWarnings, warnings.Count);
        Assert.Equal("avertissement 49", warnings[^2]);
        Assert.Equal("12 autres avertissements non transmis", warnings[^1]);
    }

    [Fact]
    public void Warnings_within_the_limit_are_kept_as_they_are_empty_ones_dropped()
    {
        Assert.Equal(["un", "deux"], PayloadLimits.Warnings(["un", "", "  ", "deux"]));
        Assert.Equal(50, PayloadLimits.Warnings(Enumerable.Repeat("x", 50)).Count);
    }

    [Fact]
    public void A_long_text_is_cut_without_splitting_a_character()
    {
        var emoji = "😀";
        var text = new string('é', 398) + emoji + "fin";

        var shortened = PayloadLimits.Shorten(text, 400);

        Assert.True(shortened.Length <= 400);
        Assert.EndsWith("é…", shortened);
        Assert.Equal("court", PayloadLimits.Shorten("court", 400));
        Assert.Equal(PayloadLimits.WarningLength, PayloadLimits.Warnings([new string('a', 1000)])[0].Length);
    }

    [Fact]
    public void The_machine_name_is_trimmed_shortened_or_left_out()
    {
        Assert.Null(PayloadLimits.DisplayName(null));
        Assert.Null(PayloadLimits.DisplayName("   "));
        Assert.Equal("Bureau", PayloadLimits.DisplayName("  Bureau "));
        Assert.Equal(120, PayloadLimits.DisplayName(new string('P', 300))!.Length);

        var document = PayloadBuilder.Build(
            new MachinePayload(Guid.Parse("00000000-0000-4000-8000-000000000001"), "PC-TEST", new string('P', 300)), [], "0.0.0-test", DateTimeOffset.UnixEpoch);
        Assert.Equal(120, document.Machine.DisplayName!.Length);
    }

    [Theory]
    [InlineData("0.8.1", "0.8.0", 1)]
    [InlineData("0.8.0", "0.8.1", -1)]
    [InlineData("0.10.0", "0.9.9", 1)]
    [InlineData("1.0.0", "1.0.0", 0)]
    [InlineData("1.0.0", "1.0.0-beta.1", 1)]
    [InlineData("1.0.0-beta.1", "1.0.0-beta.2", -1)]
    [InlineData("0.8.1+abc", "0.8.1", 0)]
    public void Versions_compare_like_on_the_site(string a, string b, int expected) =>
        Assert.Equal(expected, AgentVersions.Compare(a, b));

    [Fact]
    public void An_unreadable_version_is_never_newer()
    {
        Assert.Null(AgentVersions.Compare("version", "0.8.0"));
        Assert.False(AgentVersions.IsNewer(null, "0.8.0"));
        Assert.False(AgentVersions.IsNewer("0.9", "0.8.0"));
        Assert.True(AgentVersions.IsNewer(" 0.9.0 ", "0.8.0"));
    }
}
