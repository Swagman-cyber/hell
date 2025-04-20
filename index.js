require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

// ─── Express Server for Keep-Alive ───
const app = express();
const port = 3000;
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(port, '0.0.0.0', () => console.log(`Server running on port ${port}`));

// ─── SQLite Database Setup ───
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) return console.error('DB Error:', err.message);
  console.log('Database connected');

  db.run(`CREATE TABLE IF NOT EXISTS usedCodes (
    code TEXT PRIMARY KEY,
    robloxId TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    guildId TEXT PRIMARY KEY,
    verifiedRoleId TEXT
  )`);
});

// ─── Discord Client Setup ───
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

const pendingVerifications = new Map();

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ─── Commands ───
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // Setup command for admins
  if (command === '!setup') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ You must be an admin to use this command.');
    }

    const role = message.mentions.roles.first();
    if (!role) return message.reply('❗ Please mention a role: `!setup @VerifiedRole`');

    db.run(
      `INSERT OR REPLACE INTO settings (guildId, verifiedRoleId) VALUES (?, ?)`,
      [message.guild.id, role.id],
      (err) => {
        if (err) {
          console.error(err);
          return message.reply('❌ Error saving settings.');
        }
        message.reply(`✅ Verified role has been set to **${role.name}**.`);
      }
    );
    return;
  }

  // !verify <robloxUsername>
  if (command === '!verify') {
    const robloxUsername = args[1];
    if (!robloxUsername) {
      return message.reply('❗ Usage: `!verify <username>`');
    }

    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [robloxUsername],
        excludeBannedUsers: true
      });

      const userData = res.data.data[0];
      if (!userData) return message.reply('❌ Roblox user not found.');

      const robloxId = userData.id;
      const code = generateCode();

      pendingVerifications.set(message.author.id, { robloxId, code });

      return message.reply(
        `✅ Paste this code into your **Roblox About Me**:\n\`\`\`${code}\`\`\`\nThen type \`!confirm\` when you're done.`
      );
    } catch (error) {
      console.error(error);
      return message.reply('❌ Failed to fetch Roblox user info.');
    }
  }

  // !confirm command
  if (command === '!confirm') {
    const entry = pendingVerifications.get(message.author.id);
    if (!entry) return message.reply('❗ You need to use `!verify <username>` first.');

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      if (!description.includes(entry.code)) {
        return message.reply('❌ Verification code not found in your Roblox About Me.');
      }

      db.get(`SELECT * FROM usedCodes WHERE code = ? AND robloxId = ?`, [entry.code, entry.robloxId], (err, row) => {
        if (err) {
          console.error(err);
          return message.reply('❌ DB error.');
        }

        if (row) return message.reply('❌ Code already used.');

        // Save the used code
        db.run(`INSERT INTO usedCodes (code, robloxId) VALUES (?, ?)`, [entry.code, entry.robloxId], (err) => {
          if (err) {
            console.error(err);
            return message.reply('❌ Error saving code.');
          }

          // Fetch saved role
          db.get(`SELECT verifiedRoleId FROM settings WHERE guildId = ?`, [message.guild.id], (err, data) => {
            if (err || !data) {
              return message.reply('❗ Setup not complete. Ask an admin to use `!setup @Role`.');
            }

            const role = message.guild.roles.cache.get(data.verifiedRoleId);
            const member = message.guild.members.cache.get(message.author.id);

            if (!role || !member) {
              return message.reply('❌ Could not find the verified role or your member info.');
            }

            member.roles.add(role)
              .then(() => {
                pendingVerifications.delete(message.author.id);
                message.reply('🎉 You are now verified!');
              })
              .catch(err => {
                console.error(err);
                message.reply('❌ Failed to assign role.');
              });
          });
        });
      });
    } catch (err) {
      console.error(err);
      return message.reply('❌ Error checking your Roblox profile.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
