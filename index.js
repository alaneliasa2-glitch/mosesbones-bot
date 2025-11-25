require("dotenv").config();
const fs = require("fs-extra");
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField
} = require("discord.js");
const axios = require("axios");

// ===== ENV VARS =====
const TOKEN = process.env.TOKEN;
const GROQ_KEY = process.env.GROQ_API_KEY || "";   // <-- NEW: Groq key
const CHANNEL_ID = process.env.CHANNEL_ID;         // general chat
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || CHANNEL_ID;
const JOKE_CHANNEL_ID = process.env.JOKE_CHANNEL_ID || CHANNEL_ID;
const PREFIX = process.env.PREFIX || "!";

if (!TOKEN || !CHANNEL_ID) {
  console.error("Missing required env vars. Set TOKEN and CHANNEL_ID in environment.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// --------- Persistent warns store ----------
const WARNS_FILE = "./warns.json";
let warns = {};
if (fs.existsSync(WARNS_FILE)) {
  warns = fs.readJsonSync(WARNS_FILE);
} else {
  fs.writeJsonSync(WARNS_FILE, warns);
}

function saveWarns() {
  fs.writeJsonSync(WARNS_FILE, warns, { spaces: 2 });
}

// --------- Moderation config (medium) ----------
const BAD_WORDS = ["fuck", "shit", "bitch", "slur1", "abuse1"];

// --------- Jokes ----------
const JOKES = [
  "Why don’t skeletons fight each other? Because they don’t have the guts 😆💀",
  "I told my computer I needed a break… it showed me an ad for KitKat 🍫",
  "Why did the gamer bring a broom? To sweep the lobby 😂",
  "Why do programmers prefer dark mode? Because light attracts bugs 🪲🤣",
  "My WiFi dropped for 10 minutes… I met my family. They seem nice 😎"
];

// --------- Welcome system ----------
client.on("guildMemberAdd", async (member) => {
  try {
    const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!channel) return;

    await channel.send(
      `🎉 Welcome **${member.user.username}** to Moses Bones! Make yourself at home 😄🔥`
    );
  } catch (err) {
    console.error("Welcome error:", err);
  }
});

// --------- Daily jokes ----------
async function postDailyJoke() {
  try {
    const ch = await client.channels.fetch(JOKE_CHANNEL_ID).catch(() => null);
    if (!ch) return;
    const joke = JOKES[Math.floor(Math.random() * JOKES.length)];
    await ch.send(`😂 **Daily Joke Time!**\n${joke}`);
  } catch (err) {
    console.error("Joke error:", err);
  }
}

client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
  // send one immediately, then every 24h
  postDailyJoke();
  setInterval(postDailyJoke, 24 * 60 * 60 * 1000);
});

// --------- Main message handler (moderation + commands + AI) ----------
client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.guild) return; // ignore DMs

    const contentLower = msg.content.toLowerCase();

    // --- Bad words filter (medium) ---
    if (BAD_WORDS.some(w => contentLower.includes(w))) {
      await msg.delete().catch(() => {});
      await msg.channel.send(
        `${msg.author}, chill bro 😅— no bad words here!`
      ).catch(() => {});

      const guildId = msg.guild.id;
      warns[guildId] = warns[guildId] || {};
      const uid = msg.author.id;
      warns[guildId][uid] = (warns[guildId][uid] || 0) + 1;
      saveWarns();
      return;
    }

    // --- Only handle bot stuff in the configured channel ---
    if (msg.channel.id !== CHANNEL_ID) return;

    // ========== PREFIX COMMANDS ==========
    if (msg.content.startsWith(PREFIX)) {
      const [cmd, ...rest] = msg.content
        .slice(PREFIX.length)
        .trim()
        .split(/\s+/);
      const args = rest;

      // !warn @user reason
      if (cmd === "warn") {
        if (!msg.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
          return msg.reply("You don't have permission to warn.");
        }
        const user = msg.mentions.users.first();
        if (!user) return msg.reply("Mention a user: `!warn @user reason`");

        const reason = args.slice(1).join(" ") || "No reason provided";
        const guildId = msg.guild.id;

        warns[guildId] = warns[guildId] || {};
        warns[guildId][user.id] = (warns[guildId][user.id] || 0) + 1;
        saveWarns();

        return msg.channel.send(
          `${user} has been warned. Reason: ${reason}. Total warns: ${warns[guildId][user.id]}`
        );
      }

      // !warns @user
      if (cmd === "warns") {
        const user = msg.mentions.users.first() || msg.author;
        const g = warns[msg.guild.id] || {};
        const count = g[user.id] || 0;
        return msg.reply(`${user.tag} has ${count} warn(s).`);
      }

      // !kick @user reason
      if (cmd === "kick") {
        if (!msg.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
          return msg.reply("You don't have permission to kick.");
        }
        const member = msg.mentions.members.first();
        if (!member) return msg.reply("Mention a member to kick.");
        const reason = args.slice(1).join(" ") || "No reason provided";
        await member.kick(reason).catch(e =>
          msg.reply("Failed to kick: " + e.message)
        );
        return msg.channel.send(
          `${member.user.tag} was kicked. Reason: ${reason}`
        );
      }

      // !ban @user reason
      if (cmd === "ban") {
        if (!msg.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
          return msg.reply("You don't have permission to ban.");
        }
        const member = msg.mentions.members.first();
        if (!member) return msg.reply("Mention a member to ban.");
        const reason = args.slice(1).join(" ") || "No reason provided";
        await member.ban({ reason }).catch(e =>
          msg.reply("Failed to ban: " + e.message)
        );
        return msg.channel.send(
          `${member.user.tag} was banned. Reason: ${reason}`
        );
      }

      // !joke
      if (cmd === "joke") {
        const joke = JOKES[Math.floor(Math.random() * JOKES.length)];
        return msg.reply(`😂 ${joke}`);
      }

      // !help
      if (cmd === "help") {
        return msg.reply(
          `**Moses Bones Bot Commands:**\n` +
          `${PREFIX}help – show this message\n` +
          `${PREFIX}joke – random joke\n` +
          `${PREFIX}warn @user reason – warn (staff)\n` +
          `${PREFIX}warns @user – check warns\n` +
          `${PREFIX}kick @user reason – kick (staff)\n` +
          `${PREFIX}ban @user reason – ban (staff)\n\n` +
          `Or just chat in this channel and I'll reply with AI 😄`
        );
      }

      // If a command was handled, stop here
      return;
    }

    // ========== AI CHAT (no prefix, just talking) ==========
    if (!GROQ_KEY) {
      // if no Groq key, simple fallback message
      return msg.reply(
        "Hey! 😄 I'm Moses Bones bot — chat with me or use `!help` / `!joke`! (AI not configured yet.)"
      );
    }

    // Call Groq's OpenAI-compatible chat endpoint
    const groqResp = await axios.post(
  "https://api.groq.com/openai/v1/chat/completions",
  {
    model: "llama-3.1-8b-instant",  // new Groq model
        messages: [
          {
            role: "system",
            content:
              "You are a friendly and funny Discord bot for the Moses Bones server. Reply casually, use short messages, add light jokes sometimes, never be rude."
          },
          { role: "user", content: msg.content }
        ],
        max_tokens: 400,
        temperature: 0.8
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_KEY}`,
          "Content-Type": "application/json"
        }
      }
    ).catch(err => {
      console.error("Groq error:", err?.response?.data || err.message);
      return null;
    });

    const aiText = groqResp?.data?.choices?.[0]?.message?.content;
    if (aiText) {
      await msg.reply(aiText).catch(() => {});
    } else {
      await msg.reply("Sorry, my AI brain glitched 😅 Try again later.");
    }
  } catch (err) {
    console.error("messageCreate error:", err);
  }
});

client.login(TOKEN);
