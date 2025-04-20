require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

// === Express for uptime ===
const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(3000, () => console.log('🌐 Web server running.'));

// === SQLite Setup ===
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) {
    console.error('Database error:', err.message);
    process.exit(1);
  }
  console.log('✅ Database connected');
  db.run(`CREATE TABLE IF NOT EXISTS usedCodes (code TEXT PRIMARY KEY, robloxId TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS verifiedRoles (guildId TEXT, roleId TEXT, PRIMARY KEY (guildId, roleId))`);
});

// === Bot Setup ===
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

// === Message Handler ===
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // === !optinrole @Role ===
  if (command === '!optinrole') {
    if (!message.member.permissions.has('Administrator')) return message.reply('❌ Only admins can use this.');

    const roleId = args[1]?.match(/\d+/)?.[0];
    const role = message.guild.roles.cache.get(roleId);
    if (!role) return message.reply('❗ Usage: `!optinrole @Role`');

    db.run(`INSERT OR IGNORE INTO verifiedRoles (guildId, roleId) VALUES (?, ?)`, [message.guild.id, role.id], (err) => {
      if (err) {
        console.error(err);
        return message.reply('❌ Error saving role.');
      }
      message.reply(`✅ **${role.name}** is now a verified role.`);
    });
  }

  // === !optoutrole @Role ===
  if (command === '!optoutrole') {
    if (!message.member.permissions.has('Administrator')) return message.reply('❌ Only admins can use this.');

    const roleId = args[1]?.match(/\d+/)?.[0];
    const role = message.guild.roles.cache.get(roleId);
    if (!role) return message.reply('❗ Usage: `!optoutrole @Role`');

    db.run(`DELETE FROM verifiedRoles WHERE guildId = ? AND roleId = ?`, [message.guild.id, role.id], (err) => {
      if (err) {
        console.error(err);
        return message.reply('❌ Error removing role.');
      }
      message.reply(`✅ **${role.name}** is no longer a verified role.`);
    });
  }

  // === !verify <username> ===
  if (command === '!verify') {
    const username = args[1];
    if (!username) return message.reply('❗ Usage: `!verify <RobloxUsername>`');

    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [username],
        excludeBannedUsers: true
      });

      const userData = res.data.data[0];
      if (!userData) return message.reply('❌ User not found.');

      const robloxId = userData.id;
      const code = generateCode();
      pendingVerifications.set(message.author.id, { robloxId, code });

      message.reply(
        `✅ Paste this code into your **Roblox About Me**:\n\`\`\`${code}\`\`\`\nThen type \`!confirm\` when you're done.`
      );
    } catch (err) {
      console.error(err);
      message.reply('❌ Failed to look up Roblox username.');
    }
  }

  // === !confirm ===
  if (command === '!confirm') {
    const entry = pendingVerifications.get(message.author.id);
    if (!entry) return message.reply('❗ Use `!verify <username>` first.');

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      if (!description.includes(entry.code)) {
        return message.reply('❌ Code not found in your Roblox About Me.');
      }

      db.get('SELECT * FROM usedCodes WHERE code = ? AND robloxId = ?', [entry.code, entry.robloxId], (err, row) => {
        if (err) {
          console.error(err);
          return message.reply('❌ DB error.');
        }

        if (row) {
          return message.reply('❌ This code has already been used.');
        }

        db.run('INSERT INTO usedCodes (code, robloxId) VALUES (?, ?)', [entry.code, entry.robloxId], (err) => {
          if (err) {
            console.error(err);
            return message.reply('❌ DB error saving code.');
          }

          // Assign one of the allowed roles
          db.all('SELECT roleId FROM verifiedRoles WHERE guildId = ?', [message.guild.id], async (err, rows) => {
            if (err || rows.length === 0) {
              return message.reply('❗ No verified roles are set up. Ask an admin to run `!optinrole @Role`');
            }

            const member = message.guild.members.cache.get(message.author.id);
            let success = false;

            for (const row of rows) {
              const role = message.guild.roles.cache.get(row.roleId);
              if (role) {
                try {
                  await member.roles.add(role);
                  success = true;
                  break;
                } catch (err) {
                  console.error('Role assignment error:', err);
                }
              }
            }

            if (success) {
              pendingVerifications.delete(message.author.id);
              return message.reply('🎉 You are now verified!');
            } else {
              return message.reply('❌ Could not assign any verified roles. Make sure the bot has permission.');
            }
          });
        });
      });
    } catch (err) {
      console.error(err);
      message.reply('❌ Error while checking your Roblox profile.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
