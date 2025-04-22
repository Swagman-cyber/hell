require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

// Setup SQLite database
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Database connected');
    db.serialize(() => {
      db.all("PRAGMA table_info(usedCodes);", (err, rows) => {
        if (err) {
          console.error("❌ Error getting table info:", err);
          return;
        }

        if (!rows.length || !rows.some(row => row.name === 'robloxId')) {
          console.log('❌ Invalid table structure. Recreating the table...');
          db.run('DROP TABLE IF EXISTS usedCodes');
          db.run('CREATE TABLE usedCodes (codeHash TEXT PRIMARY KEY, robloxId TEXT)', (err) => {
            if (err) console.error('❌ Error creating usedCodes table:', err);
            else console.log('✅ usedCodes table recreated with the correct schema.');
          });
        } else {
          console.log('✅ usedCodes table is valid.');
        }
      });
    });
  }
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

const pendingVerifications = new Map();
let verificationEnabled = true;

function generateSecureCode(userId) {
  const rawCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const hmac = crypto.createHmac('sha256', process.env.SECRET_KEY);
  hmac.update(rawCode + userId);
  const hash = hmac.digest('hex');
  return { code: rawCode, hash };
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  if (command === '1verify') {
    if (!verificationEnabled) return message.reply('❌ Verification is currently disabled.');

    const robloxUsername = args[1];
    if (!robloxUsername) return message.reply('❗ Usage: 1verify <username>');

    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [robloxUsername],
        excludeBannedUsers: true
      });

      const userData = res.data.data[0];
      if (!userData) return message.reply('❌ Roblox user not found.');

      const robloxId = userData.id;
      const profileImageUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${robloxId}&width=420&height=420&format=png`;
      const { code, hash } = generateSecureCode(robloxId);

      pendingVerifications.set(message.author.id, { robloxId, code, hash });

      const embed = new EmbedBuilder()
        .setTitle('Roblox Verification')
        .setDescription(`✅ Paste this code into your Roblox **About Me**:
\`${code}\`
Then type \`1confirm\` when you're done.`)
        .setColor('Green')
        .setThumbnail(profileImageUrl);

      message.reply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      return message.reply('❌ Failed to fetch Roblox user info.');
    }
  }

  if (command === '1confirm') {
    const entry = pendingVerifications.get(message.author.id);
    if (!entry) return message.reply('❗ Use 1verify <username> first.');

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      if (description.includes(entry.code)) {
        db.get('SELECT * FROM usedCodes WHERE codeHash = ? AND robloxId = ?', [entry.hash, entry.robloxId], (err, row) => {
          if (err) {
            console.error('❌ DB lookup error:', err);
            return message.reply('❌ Error checking code.');
          }

          if (row) return message.reply('❌ This code has already been used.');

          db.run('INSERT INTO usedCodes (codeHash, robloxId) VALUES (?, ?)', [entry.hash, entry.robloxId], async (err) => {
            if (err) {
              console.error('❌ DB insert error:', err);
              return message.reply('❌ Error saving code.');
            }

            const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === 'citizen');
            if (!role) return message.reply('❌ The "Citizen" role does not exist.');

            const member = message.guild.members.cache.get(message.author.id);
            if (!member) return message.reply('❌ Could not find your Discord account.');

            try {
              await member.roles.add(role);
              pendingVerifications.delete(message.author.id);

              const profileImageUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${entry.robloxId}&width=420&height=420&format=png`;

              const embed = new EmbedBuilder()
                .setTitle('🎉 Verification Complete!')
                .setDescription('You have been verified and assigned the **Citizen** role!')
                .setColor('Green')
                .setThumbnail(profileImageUrl);

              message.reply({ embeds: [embed] });

            } catch (err) {
              console.error(err);
              return message.reply('❌ Failed to assign role.');
            }
          });
        });
      } else {
        return message.reply('❌ Verification code not found in your profile About Me.');
      }
    } catch (err) {
      console.error('❌ Error checking profile:', err);
      return message.reply('❌ Error checking your Roblox profile.');
    }
  }

  if (command === '1disableverification' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    verificationEnabled = !verificationEnabled;
    message.reply(`✅ Verification is now ${verificationEnabled ? 'enabled' : 'disabled'}.`);
  }
});

client.login(process.env.DISCORD_TOKEN);
