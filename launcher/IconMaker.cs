using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;

internal static class IconMaker
{
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool DestroyIcon(IntPtr handle);

    private static GraphicsPath RoundedRectangle(Rectangle rectangle, int radius)
    {
        GraphicsPath path = new GraphicsPath();
        int diameter = radius * 2;
        path.AddArc(rectangle.Left, rectangle.Top, diameter, diameter, 180, 90);
        path.AddArc(rectangle.Right - diameter, rectangle.Top, diameter, diameter, 270, 90);
        path.AddArc(rectangle.Right - diameter, rectangle.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rectangle.Left, rectangle.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: IconMaker <output.ico>");
            return 1;
        }

        using (Bitmap bitmap = new Bitmap(64, 64))
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.Clear(Color.Transparent);
            graphics.SmoothingMode = SmoothingMode.AntiAlias;

            using (Pen blue = new Pen(Color.FromArgb(13, 153, 255), 7f))
            using (Pen graphite = new Pen(Color.FromArgb(47, 51, 57), 7f))
            using (GraphicsPath left = RoundedRectangle(new Rectangle(8, 12, 31, 40), 7))
            using (GraphicsPath right = RoundedRectangle(new Rectangle(25, 12, 31, 40), 7))
            {
                graphics.DrawPath(blue, left);
                graphics.DrawPath(graphite, right);
                graphics.FillRectangle(Brushes.White, 29, 7, 7, 50);
                graphics.FillRectangle(new SolidBrush(Color.FromArgb(13, 153, 255)), 30, 7, 4, 50);
                graphics.FillRectangle(new SolidBrush(Color.FromArgb(13, 153, 255)), 20, 26, 12, 12);
            }

            IntPtr handle = bitmap.GetHicon();
            try
            {
                using (Icon icon = (Icon)Icon.FromHandle(handle).Clone())
                using (FileStream stream = File.Create(args[0]))
                {
                    icon.Save(stream);
                }
            }
            finally
            {
                DestroyIcon(handle);
            }
        }
        return 0;
    }
}
