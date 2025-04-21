require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

// Setup SQLite database
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Database connected');
    // Check and fix table schema if needed
    db.serialize(() => {
      // Check if the table exists and if columns are correct
      db.all("PRAGMA table_info(usedCodes);", (err, rows) => {
        if (err) {
          console.error("❌ Error getting table info:", err);
          return;
        }

        // If the table is missing or doesn't have 'robloxId', recreate it
        if (!rows.length || !rows.some(row => row.name === 'robloxId')) {
          console.log('❌ Invalid table structure. Recreating the table...');
          db.run('DROP TABLE IF EXISTS usedCodes');
          db.run('CREATE TABLE usedCodes (code TEXT PRIMARY KEY, robloxId TEXT)', (err) => {
            if (err) {
              console.error('❌ Error creating usedCodes table:', err);
            } else {
              console.log('✅ usedCodes table recreated with the correct schema.');
            }
          });
        } else {
          console.log('✅ usedCodes table is valid.');
        }
      });
    });
  }
});

const express = require('express');
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

const pendingVerifications = new Map(); // userId => { robloxId, code }

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  if (!guild) {
    console.error("❌ Guild not found. Check your GUILD_ID in the .env file.");
    process.exit(1);
  }

  console.log(`📌 Connected to guild: ${guild.name}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // Step 1: !verify <username>
  if (command === '!verify') {
    const robloxUsername = args[1];
    if (!robloxUsername) {
      return message.reply('❗ Please provide your Roblox username. Usage: `!verify <username>`');
    }

    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [robloxUsername],
        excludeBannedUsers: true
      });

      const userData = res.data.data[0];
      if (!userData) return message.reply('❌ Roblox user not found.');

      const robloxId = userData.id;
      const robloxProfileUrl = `https://www.roblox.com/users/${robloxId}/profile`;
      const profileImageUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${robloxId}&width=420&height=420&format=png`;
      const code = generateCode();

      pendingVerifications.set(message.author.id, { robloxId, code });

      // Send instructions with rich embed and profile image
      const embed = new EmbedBuilder()
        .setTitle('Roblox Verification')
        .setDescription(`✅ **Paste this code into your Roblox About Me:**\n\`\`\`${code}\`\`\`\nThen type \`!confirm\` when you're done.`)
        .setColor('Green')
        .setThumbnail(profileImageUrl)
        .setURL(robloxProfileUrl);

      return message.reply({ embeds: [embed] });

    } catch (error) {
      console.error(error);
      return message.reply('❌ Failed to fetch Roblox user info.');
    }
  }

  // Step 2: !confirm
  if (command === '!confirm') {
    const entry = pendingVerifications.get(message.author.id);
    if (!entry) return message.reply('❗ You need to use `!verify <username>` first.');

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      // Check if the verification code exists in the About Me
      if (description.includes(entry.code)) {
        // Check if the code has already been used in the database
        db.get('SELECT * FROM usedCodes WHERE code = ? AND robloxId = ?', [entry.code, entry.robloxId], (err, row) => {
          if (err) {
            console.error('❌ DB lookup error:', err);
            return message.reply('❌ Error checking code in the database.');
          }

          if (row) {
            return message.reply('❌ This code has already been used or is invalid.');
          }

          // Add the code to the usedCodes table to prevent reuse
          db.run('INSERT INTO usedCodes (code, robloxId) VALUES (?, ?)', [entry.code, entry.robloxId], (err) => {
            if (err) {
              console.error('❌ DB insert error:', err);
              return message.reply('❌ Error storing code in the database.');
            }

            // Assign the "Citizen" role
            const guild = message.guild;
            const role = guild.roles.cache.find(r => r.name.toLowerCase() === 'citizen');

            if (!role) {
              return message.reply('❌ The "Citizen" role does not exist in the server. Please create it.');
            }

            const member = guild.members.cache.get(message.author.id);
            if (!member) {
              return message.reply('❌ Failed to find your Discord account in the server.');
            }

            member.roles.add(role)
              .then(() => {
                pendingVerifications.delete(message.author.id); // Invalidate the code
                message.reply('🎉 You are now verified and have been given the **Citizen** role!');
              })
              .catch((err) => {
                console.error(err);
                message.reply('❌ Failed to assign role.');
              });
          });
        });
      } else {
        return message.reply('❌ Verification code not found in your profile. Double-check your About Me.');
      }
    } catch (err) {
      console.error('❌ Error while checking your Roblox profile:', err);
      return message.reply('❌ Error while checking your Roblox profile.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
