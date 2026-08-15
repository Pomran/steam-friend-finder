using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

// Steam Friend Finder - Native Messaging Host
// 读取本机 Steam 登录状态与当前运行游戏，供浏览器扩展调用。
// 编译：C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:host.exe host.cs
class SteamNativeHost
{
    static void Main(string[] args)
    {
        // 方便调试：直接 --status 输出 JSON，不走 Native Messaging 协议
        if (args.Length > 0 && Array.IndexOf(args, "--status") >= 0)
        {
            Console.WriteLine(BuildStatusJson());
            return;
        }

        RunMessageLoop();
    }

    static void RunMessageLoop()
    {
        Stream stdin = Console.OpenStandardInput();
        Stream stdout = Console.OpenStandardOutput();

        while (true)
        {
            int len = ReadInt32(stdin);
            if (len <= 0) break;

            byte[] buf = ReadBytes(stdin, len);
            if (buf == null) break;

            string request = Encoding.UTF8.GetString(buf);
            string response = HandleRequest(request);

            byte[] outBytes = Encoding.UTF8.GetBytes(response);
            byte[] lenBytes = BitConverter.GetBytes((uint)outBytes.Length); // Windows 小端
            stdout.Write(lenBytes, 0, 4);
            stdout.Write(outBytes, 0, outBytes.Length);
            stdout.Flush();
        }
    }

    static int ReadInt32(Stream s)
    {
        byte[] b = new byte[4];
        int read = 0;
        while (read < 4)
        {
            int n = s.Read(b, read, 4 - read);
            if (n <= 0) return 0;
            read += n;
        }
        return BitConverter.ToInt32(b, 0);
    }

    static byte[] ReadBytes(Stream s, int len)
    {
        byte[] b = new byte[len];
        int read = 0;
        while (read < len)
        {
            int n = s.Read(b, read, len - read);
            if (n <= 0) return null;
            read += n;
        }
        return b;
    }

    static string HandleRequest(string request)
    {
        // 极简命令解析，避免引入第三方 JSON 库
        if (request != null && request.Contains("\"cmd\"") && request.Contains("status"))
        {
            return BuildStatusJson();
        }
        return "{\"ok\":false,\"error\":\"unknown command\"}";
    }

    static string BuildStatusJson()
    {
        string steamPath = GetSteamPath();
        List<Account> accounts = ParseLoginUsers(steamPath);
        Account active = PickActiveAccount(accounts);
        int runningAppId = GetRunningAppId();
        string runningGameName = runningAppId > 0 ? GetAppName(runningAppId) : "";

        StringBuilder sb = new StringBuilder();
        sb.Append("{\"ok\":true");
        sb.Append(",\"steamPath\":\"" + Js(steamPath) + "\"");
        sb.Append(",\"runningAppId\":" + runningAppId);
        sb.Append(",\"runningGameName\":\"" + Js(runningGameName) + "\"");
        sb.Append(",\"activeSteamId\":\"" + Js(active != null ? active.SteamId : "") + "\"");
        sb.Append(",\"activePersonaName\":\"" + Js(active != null ? active.PersonaName : "") + "\"");
        sb.Append(",\"accounts\":[");
        for (int i = 0; i < accounts.Count; i++)
        {
            if (i > 0) sb.Append(",");
            sb.Append("{\"steamId\":\"" + Js(accounts[i].SteamId) + "\"");
            sb.Append(",\"accountName\":\"" + Js(accounts[i].AccountName) + "\"");
            sb.Append(",\"personaName\":\"" + Js(accounts[i].PersonaName) + "\"");
            sb.Append(",\"autoLogin\":" + (accounts[i].AutoLogin ? "1" : "0"));
            sb.Append(",\"mostRecent\":" + (accounts[i].MostRecent ? "1" : "0"));
            sb.Append(",\"timestamp\":" + accounts[i].Timestamp);
            sb.Append("}");
        }
        sb.Append("]}");
        return sb.ToString();
    }

    static string Js(string s)
    {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder();
        foreach (char c in s)
        {
            switch (c)
            {
                case '\\': sb.Append("\\\\"); break;
                case '"': sb.Append("\\\""); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u" + ((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    static string GetSteamPath()
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
            {
                if (k != null)
                {
                    object v = k.GetValue("SteamPath");
                    if (v != null) return v.ToString();
                }
            }
        }
        catch { }
        return "";
    }

    static int GetRunningAppId()
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
            {
                if (k != null)
                {
                    object v = k.GetValue("RunningAppID");
                    if (v != null)
                    {
                        int id = 0;
                        if (int.TryParse(v.ToString(), out id)) return id;
                    }
                }
            }
        }
        catch { }
        return 0;
    }

    static string GetAppName(int appid)
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam\Apps\" + appid))
            {
                if (k != null)
                {
                    object v = k.GetValue("Name");
                    if (v != null && !string.IsNullOrEmpty(v.ToString())) return v.ToString();
                }
            }
        }
        catch { }
        return "";
    }

    class Account
    {
        public string SteamId = "";
        public string AccountName = "";
        public string PersonaName = "";
        public bool AutoLogin = false;
        public bool MostRecent = false;
        public long Timestamp = 0;
    }

    static List<Account> ParseLoginUsers(string steamPath)
    {
        List<Account> accounts = new List<Account>();
        if (string.IsNullOrEmpty(steamPath)) return accounts;

        string file = Path.Combine(steamPath, "config", "loginusers.vdf");
        if (!File.Exists(file)) return accounts;

        Account cur = null;
        try
        {
            string[] lines = File.ReadAllLines(file, Encoding.UTF8);
            foreach (string raw in lines)
            {
                string line = raw.Trim();
                if (line.Length == 0) continue;

                Match idm = Regex.Match(line, "^\"(\\d{17})\"$");
                if (idm.Success)
                {
                    cur = new Account();
                    cur.SteamId = idm.Groups[1].Value;
                    accounts.Add(cur);
                    continue;
                }

                if (line == "}" && cur != null)
                {
                    cur = null;
                    continue;
                }

                if (cur == null) continue;
                Match kv = Regex.Match(line, "^\"([^\"]+)\"\\s+\"([^\"]*)\"$");
                if (!kv.Success) continue;

                string key = kv.Groups[1].Value;
                string val = kv.Groups[2].Value;
                switch (key)
                {
                    case "AccountName": cur.AccountName = val; break;
                    case "PersonaName": cur.PersonaName = val; break;
                    case "AutoLogin": cur.AutoLogin = val == "1"; break;
                    case "MostRecent": cur.MostRecent = val == "1"; break;
                    case "Timestamp":
                        long t;
                        if (long.TryParse(val, out t)) cur.Timestamp = t;
                        break;
                }
            }
        }
        catch { }
        return accounts;
    }

    static Account PickActiveAccount(List<Account> accounts)
    {
        if (accounts.Count == 0) return null;
        foreach (Account a in accounts) if (a.MostRecent) return a;
        foreach (Account a in accounts) if (a.AutoLogin) return a;
        Account best = accounts[0];
        foreach (Account a in accounts) if (a.Timestamp > best.Timestamp) best = a;
        return best;
    }
}
