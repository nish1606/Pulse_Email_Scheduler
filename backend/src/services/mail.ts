import nodemailer, { type Transporter } from "nodemailer";

export type MailInput = {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

let cachedTransport: Transporter | null = null;

async function buildTransport(): Promise<Transporter> {
  const host = process.env.ETHEREAL_SMTP_HOST || "smtp.ethereal.email";
  const port = Number(process.env.ETHEREAL_SMTP_PORT || 587);
  const user = process.env.ETHEREAL_SMTP_USER;
  const pass = process.env.ETHEREAL_SMTP_PASS;

  if (user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  // Dev fallback: create a temporary Ethereal test account when creds are not configured.
  const test = await nodemailer.createTestAccount();
  console.warn(
    `[mail] ETHEREAL_SMTP_USER/PASS not set. Using temporary Ethereal account ${test.user}. Set env vars for stable testing.`
  );
  return nodemailer.createTransport({
    host: test.smtp.host,
    port: test.smtp.port,
    secure: test.smtp.secure,
    auth: { user: test.user, pass: test.pass },
  });
}

export async function getMailTransport(): Promise<Transporter> {
  if (!cachedTransport) cachedTransport = await buildTransport();
  return cachedTransport;
}

export async function sendMail(input: MailInput): Promise<{ messageId: string; previewUrl: string | null }> {
  const transport = await getMailTransport();
  const info = await transport.sendMail(input);
  const previewUrl = nodemailer.getTestMessageUrl(info);
  return { messageId: info.messageId, previewUrl: typeof previewUrl === "string" ? previewUrl : null };
}
