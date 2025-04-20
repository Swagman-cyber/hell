require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

// === Setup Database ===
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('✅ Database connected');

    db.run(`CREATE TABLE IF NOT EXISTS usedCodes (
      code TEXT PRIMARY KEY,
      robloxId TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
      guildId TEXT PRIMARY KEY,
      verifiedRoleId TEXT
    )`);
  }
});

// === Express Keep-Alive Server ===
const app = express();
const port = 3000;
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(port, '0.0.0.0', () => {
  console.log(`🌐 Web server running on http://0.0.0.0:${port}`);
});

// === Discord Bot Setup ===
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

const pendingVerifications = new Map(); // userId => { robloxId, code }

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// === On Ready ===
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// === Commands ===
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // === Setup Command ===
  if (command === '!setup') {
    if (!message.member.permissions.has('Administrator')) {
      return message.reply('❌ You must be an administrator to use this command.');
    }

    const roleMention = args[1];
    const roleId = roleMention?.match(/\d+/)?.[0];
    const role = message.guild.roles.cache.get(roleId);

    if (!role) {
      return message.reply('❗ Please mention a valid role to use as the "Verified" role. Usage: `!setup @VerifiedRole`');
    }

    db.run(`INSERT OR REPLACE INTO settings (guildId, verifiedRoleId) VALUES (?, ?)`, [message.guild.id, role.id], (err) => {
      if (err) {
        console.error(err);
        return message.reply('❌ Failed to save settings.');
      }
      return message.reply(`✅ Setup complete! Members who verify will receive the **${role.name}** role.`);
    });
  }

  // === Verify Command ===
  if (command === '!verify') {
    const robloxUsername = args[1];
    if (!robloxUsername) {
      return message.reply('❗ Please provide your Roblox username. Usage: `!verify <username>`');
    }

    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [robloxUsername],
        excludeBannedUsers: true,
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

  // === Confirm Command ===
  if (command === '!confirm') {
    const entry = pendingVerifications.get(message.author.id);
    if (!entry) return message.reply('❗ You need to use `!verify <username>` first.');

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      if (!description.includes(entry.code)) {
        return message.reply('❌ Code not found in your About Me. Make sure you saved it and try again.');
      }

      // Check if already used
      db.get(`SELECT * FROM usedCodes WHERE code = ? AND robloxId = ?`, [entry.code, entry.robloxId], (err, row) => {
        if (err) {
          console.error(err);
          return message.reply('❌ DB error.');
        }

        if (row) {
          return message.reply('❌ This code has already been used.');
        }

        // Save used code
        db.run(`INSERT INTO usedCodes (code, robloxId) VALUES (?, ?)`, [entry.code, entry.robloxId], async (err) => {
          if (err) {
            console.error(err);
            return message.reply('❌ DB write error.');
          }

          // Get saved verified role
          db.get(`SELECT verifiedRoleId FROM settings WHERE guildId = ?`, [message.guild.id], async (err, row) => {
            if (err || !row) {
              console.error(err || 'No setup found.');
              return message.reply('❌ Verification role not configured. Use `!setup @RoleName` first.');
            }

            const role = message.guild.roles.cache.get(row.verifiedRoleId);
            const member = message.guild.members.cache.get(message.author.id);

            if (!role || !member) {
              return message.reply('❌ Could not assign role. Ensure the role exists and bot has permissions.');
            }

            try {
              await member.roles.add(role);
              pendingVerifications.delete(message.author.id);
              return message.reply(`🎉 You are now verified and received the **${role.name}** role!`);
            } catch (err) {
              console.error(err);
              return message.reply('❌ Failed to assign the role.');
            }
          });
        });
      });
    } catch (err) {
      console.error(err);
      return message.reply('❌ Error while checking your Roblox profile.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
