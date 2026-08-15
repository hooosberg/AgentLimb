using System;
using System.IO;
using System.Text;

namespace AgentLimb.NativeMessaging
{
    internal static class Program
    {
        private const int MaxMessageBytes = 1024 * 1024;

        private static int Main()
        {
            string executableDirectory = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            DirectoryInfo installDirectory = Directory.GetParent(executableDirectory);
            string projectDirectory = installDirectory == null
                ? executableDirectory
                : installDirectory.FullName;

            Stream input = Console.OpenStandardInput();
            Stream output = Console.OpenStandardOutput();
            byte[] lengthBuffer = new byte[4];

            while (ReadExact(input, lengthBuffer, 4))
            {
                int length = BitConverter.ToInt32(lengthBuffer, 0);
                if (length < 1 || length > MaxMessageBytes) return 1;

                byte[] request = new byte[length];
                if (!ReadExact(input, request, length)) return 1;

                string json = "{\"projectDir\":\"" + EscapeJson(projectDirectory) + "\"}";
                byte[] payload = Encoding.UTF8.GetBytes(json);
                byte[] header = BitConverter.GetBytes(payload.Length);
                output.Write(header, 0, header.Length);
                output.Write(payload, 0, payload.Length);
                output.Flush();
            }

            return 0;
        }

        private static bool ReadExact(Stream stream, byte[] buffer, int count)
        {
            int offset = 0;
            while (offset < count)
            {
                int read = stream.Read(buffer, offset, count - offset);
                if (read == 0) return offset == 0;
                offset += read;
            }
            return true;
        }

        private static string EscapeJson(string value)
        {
            return value
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n");
        }
    }
}
