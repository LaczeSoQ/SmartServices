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
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Machining Owner Bot is online!');
});

app.listen(PORT, () => {
    console.log(`Owner Server listening on port ${PORT}`);
});

// ฟังก์ชันหน่วงเวลา (มิลลิวินาที)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function callGeminiWithFallback(promptText) {
    const apiKeys = [
        process.env.GEMINI_API_KEY_1,
        process.env.GEMINI_API_KEY_2,
        process.env.GEMINI_API_KEY_3
    ].filter(Boolean);

    if (apiKeys.length === 0) {
        throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Environment Variables ของ Render");
    }

    const modelsToTry = [
	"gemini-3.5-flash-lite",
        "gemini-3.8-flash"
    ];
    
    let lastError = null;

    for (const modelName of modelsToTry) {
        for (let i = 0; i < apiKeys.length; i++) {
            try {
                console.log(`กำลังเรียกใช้ ${modelName} ด้วย Key ที่ ${i + 1}...`);
                const genAI = new GoogleGenerativeAI(apiKeys[i]);
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(promptText);
                const response = await result.response;
                return response.text();
            } catch (error) {
                console.warn(`⚠️ ${modelName} (Key ${i + 1}) ล้มเหลว:`, error.message);
                lastError = error;
                await sleep(2000);
            }
        }
    }
    throw new Error(`Gemini API ล้มเหลวทุก Key และทุก Model: ${lastError ? lastError.message : 'Unknown error'}`);
}

function parseAiResponse(aiResponse, fallbackDetails) {
    let companyName = "ไม่ระบุ";
    let customerName = "ไม่ระบุ";
    let jobType = "ไม่ระบุ";
    let jobDetails = fallbackDetails || "ไม่ระบุ";

    const lines = aiResponse.split('\n');
    for (const line of lines) {
        const cleanLine = line.replace(/[*_`]/g, '').trim();
        if (cleanLine.includes('ชื่อบริษัทลูกค้า')) {
            const parts = cleanLine.split(':');
            if (parts[1] && parts[1].trim() && parts[1].trim() !== '-') companyName = parts[1].trim();
        } else if (cleanLine.includes('ชื่อลูกค้า')) {
            const parts = cleanLine.split(':');
            if (parts[1] && parts[1].trim() && parts[1].trim() !== '-') customerName = parts[1].trim();
        } else if (cleanLine.includes('ประเภทงาน')) {
            const parts = cleanLine.split(':');
            if (parts[1] && parts[1].trim() && parts[1].trim() !== '-') jobType = parts[1].trim();
        } else if (cleanLine.includes('รายละเอียดงาน')) {
            const parts = cleanLine.split(':');
            if (parts[1] && parts[1].trim() && parts[1].trim() !== '-') jobDetails = parts[1].trim();
        }
    }

    return { companyName, customerName, jobType, jobDetails };
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const postDataMap = new Map();

client.once('ready', () => {
    console.log(`Owner Bot Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.channel.isThread()) {
        const threadId = message.channel.id;
        
        let postData = postDataMap.get(threadId);
        if (!postData) {
            postData = {
                ownerId: message.author.id,
                contents: [message.content],
                botMessage: null,
                isConfirmed: false,
                summaryMessage: null,
                currentSummary: null,
                pendingUpdateContent: null,
                updateBotMessage: null
            };
            postDataMap.set(threadId, postData);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_summary')
                    .setLabel('✅ ยืนยันข้อมูลและสรุปงาน')
                    .setStyle(ButtonStyle.Success)
            );

            postData.botMessage = await message.reply({
                content: `📌 **ข้อมูลครบหรือยัง?** กดยืนยันด้านล่างได้เลย (หากมีเพิ่มพิมพ์ส่งมาได้ครับ)`,
                components: [row]
            });
        } else {
            if (postData.isConfirmed) {
                postData.pendingUpdateContent = message.content;

                const updateRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_update')
                        .setLabel('🔄 อัปเดตข้อมูลสรุป')
                        .setStyle(ButtonStyle.Primary)
                );

                if (postData.updateBotMessage) {
                    await postData.updateBotMessage.delete().catch(() => {});
                }

                postData.updateBotMessage = await message.reply({
                    content: `📝 **ตรวจพบข้อความเพิ่มเติม:** "${message.content}"\nต้องการกดอัปเดตข้อมูลสรุปงานใหม่ไหมครับ?`,
                    components: [updateRow]
                });
            } else {
                postData.contents.push(message.content);
            }
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const threadId = interaction.channel.id;
    const postData = postDataMap.get(threadId);

    if (!postData) {
        return interaction.reply({ 
            content: '❌ ไม่พบข้อมูลโพสต์นี้ในระบบ กรุณาลองใหม่อีกครั้ง', 
            ephemeral: true 
        });
    }

    if (interaction.user.id !== postData.ownerId) {
        return interaction.reply({ 
            content: '❌ เฉพาะเจ้าของโพสต์เท่านั้นที่มีสิทธิ์กดปุ่มนี้ครับ', 
            ephemeral: true 
        });
    }

    // 1. กดปุ่มยืนยันสรุปงานครั้งแรก
    if (interaction.customId === 'confirm_summary') {
        await interaction.update({
            content: `⏳ **กำลังประมวลผลข้อมูลด้วย AI...**`,
            components: []
        });

        const fullContent = postData.contents.join('\n');

        try {
            const prompt = `วิเคราะห์โพสต์งานโรงกลึงนี้: "${fullContent}"
วิเคราะห์และดึงข้อมูลตามเงื่อนไขนี้อย่างเคร่งครัด:
1. ชื่อบริษัทลูกค้า: หากไม่มีการระบุชื่อบริษัทหรือตัวย่อในข้อความ ให้ตอบว่า "ไม่ระบุ"
3. ประเภทงาน: ระบุว่าเป็น "ทำใหม่" หรือ "แก้ไข" แต่ถ้าไม่ได้ระบุประเภทงานมา ให้ตอบว่า "ไม่ระบุ"
4. รายละเอียดงาน: หากไม่มีรายละเอียดงาน ให้ตอบว่า "ไม่ระบุ" (หากมีคำว่าตามตัวอย่าง ให้ระบุตามนั้น)
5. ชื่อบริษัทลูกค้า: มักเป็นตัวย่อ/ชื่อย่อ (เช่น CGS)
6. ชื่อลูกค้า: มักจะมีคำว่า "k.", "คุณ", หรือชื่อบุคคลต่อท้ายชื่อบริษัท (เช่น k.สาคร, คุณสาคร, ช่างสาคร) ห้ามสับสนกับชื่อบริษัท หากไม่มีการระบุชื่อบุคคล ในข้อความ ให้ตอบว่า "ไม่ระบุ"
7. ประเภทงาน: ระบุว่าเป็น "ทำใหม่" หรือ "แก้ไข" แต่ถ้าในข้อความไม่ได้ระบุประเภทงานมาเลย ให้ตอบว่า "ไม่ระบุ"
8. รายละเอียดงาน: หากมีคำว่า "ตามตัวอย่าง", "ตาม ตย.", "ตามรูป", "ตามไฟล์แนบ" ให้สรุปว่าอ้างอิงรายละเอียดตามรูปภาพตัวอย่างที่แนบมาด้วย

จัดรูปแบบการตอบดังนี้:
- ชื่อบริษัทลูกค้า: [ระบุชื่อบริษัท/ชื่อย่อ หรือ ไม่ระบุ]
- ชื่อลูกค้า: [ระบุชื่อลูกค้า หรือ ไม่ระบุ]
- ประเภทงาน: [ทำใหม่, แก้ไข, หรือ ไม่ระบุ]
- รายละเอียดงาน: [ระบุรายละเอียดงาน หรือ ไม่ระบุ]`;

            const aiResponse = await callGeminiWithFallback(prompt);
            const parsed = parseAiResponse(aiResponse, fullContent);

            const employeeName = interaction.member ? interaction.member.displayName : interaction.user.username;
            const currentDate = new Date().toISOString().split('T')[0];
            const newThreadName = parsed.companyName !== "ไม่ระบุ" ? `${currentDate} - ${parsed.companyName}` : `${currentDate} - งานใหม่`;

            try {
                await interaction.channel.setName(newThreadName);
            } catch (error) {
                console.error('ไม่สามารถเปลี่ยนชื่อ Thread ได้:', error);
            }

            const summaryEmbed = new EmbedBuilder()
                .setTitle('📋 สรุปข้อมูลงาน')
                .setColor(0x00FF00)
                .addFields(
                    { name: '🏢 ชื่อบริษัทลูกค้า', value: parsed.companyName, inline: false },
                    { name: '👤 ชื่อลูกค้า', value: parsed.customerName, inline: false },
                    { name: '👨‍💻 ชื่อพนักงาน (ผู้บันทึก)', value: employeeName, inline: false },
                    { name: '📌 ประเภทงาน', value: parsed.jobType, inline: false },
                    { name: '⚙️ รายละเอียดงาน', value: parsed.jobDetails, inline: false }
                )
                .setTimestamp();

            // 1. ส่งการ์ดสรุปอันใหม่ลงไปก่อน
            const summaryEmbedMsg = await interaction.channel.send({ embeds: [summaryEmbed] });

            // 2. ค่อยลบการ์ดสรุปอันเก่าทิ้ง (ถ้ามี)
            if (postData.summaryMessage) {
                await postData.summaryMessage.delete().catch(() => {});
            }

            // ลบข้อความปุ่มกดเริ่มต้น
            if (postData.botMessage) {
                await postData.botMessage.delete().catch(() => {});
            }

            postData.isConfirmed = true;
            postData.summaryMessage = summaryEmbedMsg;
            postData.currentSummary = parsed;

        } catch (err) {
            console.error("Summary Error:", err);
            
            await interaction.followUp({ 
                content: `❌ เกิดข้อผิดพลาด: ${err.message}`, 
                ephemeral: true 
            });

            if (postData.botMessage) {
                const retryRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_summary')
                        .setLabel('✅ ยืนยันข้อมูลและสรุปงาน')
                        .setStyle(ButtonStyle.Success)
                );
                await interaction.editReply({
                    content: `❌ **เกิดข้อผิดพลาดในการประมวลผล:** ${err.message}\n(สามารถกดยืนยันใหม่อีกครั้งได้เลยครับ)`,
                    components: [retryRow]
                }).catch(() => {});
            }
        }
    }

    // 2. กดปุ่มยืนยันอัปเดตข้อมูลเพิ่มเติม
    if (interaction.customId === 'confirm_update') {
        await interaction.update({
            content: `⏳ **กำลังอัปเดตสรุปข้อมูลด้วย AI...**`,
            components: []
        });

        try {
            const updatePrompt = `ข้อมูลสรุปเดิม:
- ชื่อบริษัทลูกค้า: ${postData.currentSummary.companyName}
- ชื่อลูกค้า: ${postData.currentSummary.customerName}
- ประเภทงาน: ${postData.currentSummary.jobType}
- รายละเอียดงาน: ${postData.currentSummary.jobDetails}

ข้อความแก้ไขหรือเพิ่มติมที่ส่งมาใหม่: "${postData.pendingUpdateContent}"

จงอัปเดตข้อมูลทั้งหมดให้สอดคล้องกับข้อความใหม่ โดยคงค่าเดิมไว้หากไม่มีการพูดถึงการเปลี่ยนแปลง หากข้อมูลส่วนไหนไม่มีการระบุ ให้ตอบว่า "ไม่ระบุ" และจัดรูปแบบการตอบดังนี้:
- ชื่อบริษัทลูกค้า: [ระบุชื่อบริษัท/ชื่อย่อ หรือ ไม่ระบุ]
- ชื่อลูกค้า: [ระบุชื่อลูกค้า หรือ ไม่ระบุ]
- ประเภทงาน: [ทำใหม่, แก้ไข, หรือ ไม่ระบุ]
- รายละเอียดงาน: [ระบุรายละเอียดงาน หรือ ไม่ระบุ]`;

            const aiResponse = await callGeminiWithFallback(updatePrompt);
            const parsed = parseAiResponse(aiResponse, postData.currentSummary.jobDetails);

            const currentDate = new Date().toISOString().split('T')[0];
            const newThreadName = parsed.companyName !== "ไม่ระบุ" ? `${currentDate} - ${parsed.companyName}` : `${currentDate} - งานอัปเดต`;

            try {
                await interaction.channel.setName(newThreadName);
            } catch (error) {
                console.error('ไม่สามารถเปลี่ยนชื่อ Thread ได้:', error);
            }

            const employeeName = interaction.member ? interaction.member.displayName : interaction.user.username;

            const updatedEmbed = new EmbedBuilder()
                .setTitle('📋 สรุปข้อมูลงาน')
                .setColor(0x00FF00)
                .addFields(
                    { name: '🏢 ชื่อบริษัทลูกค้า', value: parsed.companyName, inline: false },
                    { name: '👤 ชื่อลูกค้า', value: parsed.customerName, inline: false },
                    { name: '👨‍💻 ชื่อพนักงาน (ผู้บันทึก)', value: employeeName, inline: false },
                    { name: '📌 ประเภทงาน', value: parsed.jobType, inline: false },
                    { name: '⚙️ รายละเอียดงาน', value: parsed.jobDetails, inline: false }
                )
                .setTimestamp();

            // 1. ส่งการ์ดสรุปอันใหม่ลงไปก่อน
            const newSummaryMsg = await interaction.channel.send({ embeds: [updatedEmbed] });

            // 2. ค่อยลบการ์ดสรุปอันเก่าทิ้ง
            if (postData.summaryMessage) {
                await postData.summaryMessage.delete().catch(() => {});
            }

            // ลบข้อความปุ่มอัปเดตทิ้ง
            if (postData.updateBotMessage) {
                await postData.updateBotMessage.delete().catch(() => {});
            }

            postData.summaryMessage = newSummaryMsg;
            postData.currentSummary = parsed;
            postData.pendingUpdateContent = null;

        } catch (err) {
            console.error("Update Error:", err);
            
            await interaction.followUp({ 
                content: `❌ เกิดข้อผิดพลาดในการอัปเดต: ${err.message}`, 
                ephemeral: true 
            });

            if (postData.updateBotMessage) {
                const retryUpdateRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_update')
                        .setLabel('🔄 อัปเดตข้อมูลสรุป')
                        .setStyle(ButtonStyle.Primary)
                );
                await interaction.editReply({
                    content: `❌ **เกิดข้อผิดพลาดในการอัปเดต:** ${err.message}\n(สามารถกดปุ่มอัปเดตใหม่อีกครั้งได้เลยครับ)`,
                    components: [retryUpdateRow]
                }).catch(() => {});
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);