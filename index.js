require('dotenv').config();
const express = require('express');
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');

// 1. เปิด Web Server เล็กๆ สำหรับให้ Render ทำ Health Check (รัน 24/7)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Machining Discord Bot is online and running!');
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});


// ใช้สำหรับเก็บข้อมูลโพสต์ชั่วคราวขณะบอททำงาน
const postDataMap = new Map();

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// เมื่อมีการสร้างโพสต์ใหม่ (ฟอรัมโพสต์จะอยู่ในรูปของ Thread)
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.channel.isThread()) {
        const threadId = message.channel.id;
        
        // เก็บข้อมูลเจ้าของโพสต์และเนื้อหา
        postDataMap.set(threadId, {
            ownerId: message.author.id,
            title: message.channel.name,
            content: message.content
        });

        // ปุ่มสำหรับ "ผู้เห็นโพสต์" (กดเพื่อขอข้อมูลเพิ่มเติมเกี่ยวกับงานโรงกลึง)
        const viewerRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ask_details')
                .setLabel('🔍 ขอรายละเอียดชิ้นงาน')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ask_dims')
                .setLabel('📏 ขอข้อมูลขนาด')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ask_material')
                .setLabel('🔩 ขอข้อมูลวัสดุ')
                .setStyle(ButtonStyle.Secondary)
        );

        // ปุ่มสำหรับ "เจ้าของโพสต์" เท่านั้น
        const ownerRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('owner_confirm')
                .setLabel('✅ ยืนยันข้อมูลครบถ้วน')
                .setStyle(ButtonStyle.Success)
        );

        await message.reply({
            content: '📌 **ระบบตรวจสอบข้อมูลงานโรงกลึง:** กรุณาตรวจสอบความครบถ้วนของข้อมูลด้านบน',
            components: [viewerRow, ownerRow]
        });
    }
});

// จัดการเมื่อมีคนกดปุ่ม (Interactions)
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const threadId = interaction.channel.id;
    const postData = postDataMap.get(threadId);

    if (!postData) {
        return interaction.reply({ content: 'ไม่พบข้อมูลโพสต์นี้ในระบบ', ephemeral: true });
    }

    const userId = interaction.user.id;

    // --- กรณีผู้ชมกดปุ่มขอข้อมูลเพิ่มเติม ---
    if (['ask_details', 'ask_dims', 'ask_material'].includes(interaction.customId)) {
        if (userId === postData.ownerId) {
            return interaction.reply({ content: 'คุณเป็นเจ้าของโพสต์ ไม่จำเป็นต้องกดเตือนตัวเองครับ', ephemeral: true });
        }

        let question = "";
        if (interaction.customId === 'ask_details') question = "รายละเอียดชิ้นงานเพิ่มเติม";
        if (interaction.customId === 'ask_dims') question = "ข้อมูลขนาด (ความกว้าง/ความยาว)";
        if (interaction.customId === 'ask_material') question = "ข้อมูลวัสดุที่ใช้ผลิต";

        return interaction.reply({
            content: `📢 **แจ้งเตือนจากผู้เยี่ยมชมถึงเจ้าของโพสต์ (<@${postData.ownerId}>):** รบกวนขอข้อมูล **${question}** เพิ่มเติมหน่อยครับ`
        });
    }

    // --- กรณีเจ้าของโพสต์กดยืนยันว่าข้อมูลครบถ้วน ---
    if (interaction.customId === 'owner_confirm') {
        if (userId !== postData.ownerId) {
            return interaction.reply({ content: 'เฉพาะเจ้าของโพสต์เท่านั้นที่มีสิทธิ์กดยืนยันข้อมูลนี้ครับ', ephemeral: true });
        }

        // จัดการเปลี่ยนชื่อโพสต์เป็น "วันที่ - ชื่องานเดิม"
        const currentDate = new Date().toISOString().split('T')[0];
        const cleanTitle = postData.title.replace(/^\[.*?\]\s*/, ''); // ลบแท็กเดิมเผื่อมี
        const newThreadName = `${currentDate} - ${cleanTitle}`;
        
        try {
            await interaction.channel.setName(newThreadName);
        } catch (error) {
            console.error('ไม่สามารถเปลี่ยนชื่อ Thread ได้:', error);
        }

        // สร้าง Embed สรุปข้อมูลส่งลงในโพสต์
        const summaryEmbed = new EmbedBuilder()
            .setTitle('📋 สรุปข้อมูลงานโรงกลึง (ข้อมูลครบถ้วน)')
            .setDescription(`**ชื่องาน:** ${cleanTitle}\n**วันที่อัปเดต:** ${currentDate}\n\n**รายละเอียดเบื้องต้น:**\n${postData.content}`)
            .setColor(0x00FF00)
            .setTimestamp();

        await interaction.channel.send({ embeds: [summaryEmbed] });
        
        // ลบปุ่มออกหลังจากยืนยันเรียบร้อยแล้ว
        return interaction.update({ 
            content: '✅ **ยืนยันข้อมูลสำเร็จ:** บอทได้ทำการอัปเดตชื่อโพสต์และสรุปข้อมูลเรียบร้อยแล้วครับ!', 
            components: [] 
        });
    }
});

// เริ่มต้นทำงานบอทโดยดึง Token จาก Environment Variable
client.login(process.env.DISCORD_TOKEN);