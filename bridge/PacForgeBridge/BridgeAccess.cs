using System;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace PacForgeBridge
{
    /// <summary>
    /// Mesh binding and bearer-token access for the bridge (PHUB-210).
    /// The hosted Pac Hub reaches an engineer's own bridge over the NetBird mesh,
    /// so the bridge can bind the machine's NetBird address and require a token.
    /// </summary>
    public static class BridgeAccess
    {
        /// <summary>
        /// Resolves a --bind value to a listener host. "mesh" finds the NetBird
        /// interface address; anything else is used as given. Null/empty = localhost.
        /// </summary>
        public static string ResolveBindHost(string bind)
        {
            if (string.IsNullOrWhiteSpace(bind)) return "localhost";
            if (!string.Equals(bind.Trim(), "mesh", StringComparison.OrdinalIgnoreCase)) return bind.Trim();

            string meshIp = FindMeshAddress();
            if (meshIp == null)
                throw new InvalidOperationException(
                    "--bind mesh: no NetBird address found (no 'wt0' adapter and no IPv4 in 100.64.0.0/10). Is NetBird connected?");
            return meshIp;
        }

        /// <summary>
        /// The NetBird address of this machine: the IPv4 in 100.64.0.0/10 on the
        /// 'wt0' (or NetBird-named) adapter, else the first such IPv4 on any adapter that is up.
        /// </summary>
        public static string FindMeshAddress()
        {
            var adapters = NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up)
                .ToList();

            Func<NetworkInterface, string> cgnatV4 = n => n.GetIPProperties().UnicastAddresses
                .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork && IsCgnat(a.Address))
                .Select(a => a.Address.ToString())
                .FirstOrDefault();

            foreach (var n in adapters)
            {
                bool named = string.Equals(n.Name, "wt0", StringComparison.OrdinalIgnoreCase)
                    || (n.Description ?? "").IndexOf("wt0", StringComparison.OrdinalIgnoreCase) >= 0
                    || (n.Name ?? "").IndexOf("netbird", StringComparison.OrdinalIgnoreCase) >= 0
                    || (n.Description ?? "").IndexOf("netbird", StringComparison.OrdinalIgnoreCase) >= 0;
                if (!named) continue;
                string ip = cgnatV4(n);
                if (ip != null) return ip;
            }
            foreach (var n in adapters)
            {
                string ip = cgnatV4(n);
                if (ip != null) return ip;
            }
            return null;
        }

        /// <summary>100.64.0.0/10 — the CGNAT range NetBird allocates peer addresses from.</summary>
        public static bool IsCgnat(IPAddress address)
        {
            byte[] b = address.GetAddressBytes();
            return b.Length == 4 && b[0] == 100 && (b[1] & 0xC0) == 64;
        }

        /// <summary>
        /// True when the Authorization header carries "Bearer &lt;token&gt;".
        /// Compared in constant time over SHA-256 digests, so neither content nor length leaks.
        /// </summary>
        public static bool IsAuthorised(string authorizationHeader, string token)
        {
            if (string.IsNullOrEmpty(token)) return true;
            const string prefix = "Bearer ";
            string presented = "";
            if (authorizationHeader != null && authorizationHeader.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                presented = authorizationHeader.Substring(prefix.Length).Trim();

            byte[] a, b;
            using (var sha = SHA256.Create())
            {
                a = sha.ComputeHash(Encoding.UTF8.GetBytes(presented));
                b = sha.ComputeHash(Encoding.UTF8.GetBytes(token));
            }
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0 && presented.Length > 0;
        }
    }
}
