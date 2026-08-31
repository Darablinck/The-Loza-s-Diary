import { Hono } from 'hono';
import { Bot, InlineKeyboard } from 'grammy';
import { createClient } from '@supabase/supabase-js';

// ========== КОНФИГ ==========
const DEFAULT_GIF = "https://i.pinimg.com/originals/1a/e0/4a/1ae04a0768ea9addf942d0bfbd7b7825.gif";

// ========== ИНИЦИАЛИЗАЦИЯ ==========
const app = new Hono();

// ========== ФУНКЦИИ БАЗЫ ДАННЫХ ==========

async function getChapter(supabase, num) {
    const { data, error } = await supabase
        .from('chapters')
        .select('*')
        .eq('number', num)
        .single();
    if (error) return null;
    return data;
}

async function addChapter(supabase, number, title, pages = 0, has_pdf = false, pdf_file_id = null) {
    const { error } = await supabase
        .from('chapters')
        .upsert({ number, title, pages, has_pdf, pdf_file_id });
    return !error;
}

async function updateChapterPdf(supabase, number, has_pdf = true, pdf_file_id = null) {
    const { error } = await supabase
        .from('chapters')
        .update({ has_pdf, pdf_file_id })
        .eq('number', number);
    return !error;
}

async function updateChapterPages(supabase, number, pages) {
    const { error } = await supabase
        .from('chapters')
        .update({ pages })
        .eq('number', number);
    return !error;
}

async function addPage(supabase, chapter, page, file_id) {
    const { error } = await supabase
        .from('pages')
        .upsert({ chapter, page, file_id });
    return !error;
}

async function getPageFileId(supabase, chapter, page) {
    const { data, error } = await supabase
        .from('pages')
        .select('file_id')
        .eq('chapter', chapter)
        .eq('page', page)
        .single();
    if (error) return null;
    return data.file_id;
}

async function getPagesCount(supabase, chapter) {
    const { count, error } = await supabase
        .from('pages')
        .select('*', { count: 'exact', head: true })
        .eq('chapter', chapter);
    if (error) return 0;
    return count || 0;
}

async function getAllChapters(supabase) {
    const { data, error } = await supabase
        .from('chapters')
        .select('*')
        .order('number');
    if (error) return [];
    return data;
}

async function deleteChapter(supabase, chapter) {
    await supabase.from('pages').delete().eq('chapter', chapter);
    await supabase.from('chapters').delete().eq('number', chapter);
    return true;
}

async function saveUser(supabase, user_id, username, first_name) {
    const { error } = await supabase
        .from('users')
        .upsert({
            user_id,
            username: username || '',
            first_name: first_name || '',
            created_at: new Date().toISOString()
        });
    return !error;
}

async function getProgress(supabase, user_id) {
    const { data, error } = await supabase
        .from('progress')
        .select('*')
        .eq('user_id', user_id)
        .single();
    if (error) return { chapter: 1, page: 1 };
    return { chapter: data.chapter, page: data.page };
}

async function saveProgress(supabase, user_id, chapter, page) {
    const { error } = await supabase
        .from('progress')
        .upsert({ user_id, chapter, page });
    return !error;
}

async function getSettings(supabase) {
    const { data, error } = await supabase
        .from('settings')
        .select('*')
        .eq('key', 'welcome_gif')
        .single();
    if (error) return { value: DEFAULT_GIF };
    return data;
}

async function updateSettings(supabase, key, value) {
    const { error } = await supabase
        .from('settings')
        .upsert({ key, value });
    return !error;
}

// ========== КЛАВИАТУРЫ ==========

function mainKb() {
    return new InlineKeyboard()
        .text('📖 Читать', 'read')
        .text('📚 Оглавление', 'contents')
        .row()
        .text('🔐 Админ-панель', 'admin_panel');
}

function adminKb() {
    return new InlineKeyboard()
        .text('📤 Загрузить PNG', 'admin_png')
        .row()
        .text('📤 Загрузить PDF', 'admin_pdf')
        .row()
        .text('📋 Список глав', 'admin_list')
        .row()
        .text('🗑️ Удалить главу', 'admin_delete')
        .row()
        .text('🖼️ Сменить GIF', 'admin_change_gif')
        .row()
        .text('🔙 Назад', 'main');
}

async function chaptersKb(supabase) {
    const kb = new InlineKeyboard();
    const chapters = await getAllChapters(supabase);
    
    if (chapters.length === 0) {
        kb.text('📖 Нет глав', 'none');
    } else {
        for (const ch of chapters) {
            const pages = await getPagesCount(supabase, ch.number);
            const pdfIcon = ch.has_pdf ? ' 📄' : '';
            kb.text(
                `📖 Глава ${ch.number}: ${ch.title} (${pages} стр.)${pdfIcon}`,
                `ch_${ch.number}`
            ).row();
        }
    }
    
    kb.text('🔙 Назад', 'main');
    return kb;
}

async function chapterKb(supabase, chapter) {
    const kb = new InlineKeyboard()
        .text('🖼️ Постранично', `png_${chapter}`)
        .text('📸 Альбом', `album_${chapter}`)
        .row();
    
    const ch = await getChapter(supabase, chapter);
    if (ch && ch.has_pdf) {
        kb.text('📄 Скачать PDF', `pdf_${chapter}`).row();
    }
    
    kb.text('🔙 Назад', 'contents');
    return kb;
}

function pageKb(chapter, page, total) {
    const kb = new InlineKeyboard();
    
    if (page > 1) {
        kb.text('⬅️', `p_${chapter}_${page-1}`);
    } else {
        kb.text('⬅️', 'none');
    }
    
    kb.text(`${page}/${total}`, 'none');
    
    if (page < total) {
        kb.text('➡️', `p_${chapter}_${page+1}`);
    } else {
        kb.text('➡️', 'none');
    }
    
    kb.row()
        .text('🏠 Меню', 'main')
        .text('📚 Оглавление', 'contents');
    
    return kb;
}

// ========== ТЕКСТ ПРИВЕТСТВИЯ ==========

const WELCOME_TEXT = `. ⋅ ˚̣- : ✧ : – ⭒ ⊹ ⭒ – : ✧ : -˚̣⋅ .
💌Добро пожаловать в дневник Лозы — место,в котором любые записки оживают подобно сну🕯️
. ⋅ ˚̣- : ✧ : – ⭒ ⊹ ⭒ – : ✧ : -˚̣⋅ .
Здесь ты можешь читать главы книги в удобном формате.
. ⋅ ˚̣- : ✧ : – ⭒ ⊹ ⭒ – : ✧ : -˚̣⋅ .
📖 Что уже записано в дневнике:
• Постраничное чтение истории в PNG формате 
• Скачивание PDF файлов 
• Возможность оставить обратную связь через тгк автора 
. ⋅ ˚̣- : ✧ : – ⭒ ⊹ ⭒ – : ✧ : -˚̣⋅ .
👇 Выбери действие:`;

// ========== ОБРАБОТЧИКИ ==========

async function handleUpdate(supabase, bot, adminStates, ADMIN_ID, update) {
    if (update.message?.text) {
        const text = update.message.text;
        const user = update.message.from;
        const chatId = update.message.chat.id;
        
        if (text === '/start') {
            await saveUser(supabase, user.id, user.username, user.first_name);
            
            const settings = await getSettings(supabase);
            const gifUrl = settings.value || DEFAULT_GIF;
            
            try {
                await bot.api.sendAnimation(chatId, gifUrl, {
                    caption: WELCOME_TEXT,
                    parse_mode: 'Markdown',
                    reply_markup: mainKb()
                });
            } catch (error) {
                await bot.api.sendMessage(chatId, WELCOME_TEXT, {
                    parse_mode: 'Markdown',
                    reply_markup: mainKb()
                });
            }
            return;
        }
        
        if (text === '/admin') {
            if (user.id !== ADMIN_ID) {
                await bot.api.sendMessage(chatId, '⛔ Нет доступа!');
                return;
            }
            await bot.api.sendMessage(
                chatId,
                '🔐 *Админ-панель*\n\nВыбери действие:',
                {
                    parse_mode: 'Markdown',
                    reply_markup: adminKb()
                }
            );
            return;
        }
        
        if (user.id === ADMIN_ID && adminStates.has(ADMIN_ID)) {
            await processAdminStep(supabase, bot, adminStates, ADMIN_ID, update);
            return;
        }
        
        await bot.api.sendMessage(chatId, '🌸 Напиши /start чтобы начать чтение');
        return;
    }
    
    if (update.callback_query) {
        const data = update.callback_query.data;
        const user = update.callback_query.from;
        const chatId = update.callback_query.message.chat.id;
        const msgId = update.callback_query.message.message_id;
        
        try {
            if (data === 'admin_panel') {
                if (user.id !== ADMIN_ID) {
                    await bot.api.answerCallbackQuery(update.callback_query.id, { 
                        text: '⛔ Нет доступа!', 
                        show_alert: true 
                    });
                    return;
                }
                
                await bot.api.answerCallbackQuery(update.callback_query.id);
                
                await bot.api.editMessageText(
                    chatId,
                    msgId,
                    '🔐 *Админ-панель*\n\nВыбери действие:',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: adminKb()
                    }
                );
                return;
            }
            
            if (data.startsWith('admin_')) {
                if (user.id !== ADMIN_ID) {
                    await bot.api.answerCallbackQuery(update.callback_query.id, { 
                        text: '⛔ Нет доступа!', 
                        show_alert: true 
                    });
                    return;
                }
                await processAdminCallback(supabase, bot, adminStates, ADMIN_ID, update.callback_query);
                return;
            }
            
            if (data === 'none') {
                await bot.api.answerCallbackQuery(update.callback_query.id);
                return;
            }
            
            if (data === 'main') {
                await bot.api.answerCallbackQuery(update.callback_query.id);
                
                const settings = await getSettings(supabase);
                const gifUrl = settings.value || DEFAULT_GIF;
                
                try {
                    await bot.api.editMessageMedia(
                        chatId,
                        msgId,
                        {
                            type: 'animation',
                            media: gifUrl,
                            caption: WELCOME_TEXT,
                            parse_mode: 'Markdown'
                        },
                        { reply_markup: mainKb() }
                    );
                } catch (error) {
                    await bot.api.deleteMessage(chatId, msgId);
                    await bot.api.sendAnimation(chatId, gifUrl, {
                        caption: WELCOME_TEXT,
                        parse_mode: 'Markdown',
                        reply_markup: mainKb()
                    });
                }
                return;
            }
            
            if (data === 'contents' || data === 'read') {
                await bot.api.answerCallbackQuery(update.callback_query.id);
                const chapters = await getAllChapters(supabase);
                
                let text = '📚 *Оглавление*\n\n';
                if (chapters.length === 0) {
                    text = '📚 *Оглавление*\n\nПока нет загруженных глав.';
                } else {
                    for (const ch of chapters) {
                        const pages = await getPagesCount(supabase, ch.number);
                        const pdfIcon = ch.has_pdf ? ' 📄' : '';
                        text += `• Глава ${ch.number} — ${ch.title} (${pages} стр.)${pdfIcon}\n`;
                    }
                }
                
                await bot.api.editMessageText(
                    chatId,
                    msgId,
                    text,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: await chaptersKb(supabase)
                    }
                );
                return;
            }
            
            if (data.startsWith('ch_')) {
                const chapter = parseInt(data.split('_')[1]);
                const ch = await getChapter(supabase, chapter);
                
                if (!ch) {
                    await bot.api.sendMessage(chatId, '❌ Глава не найдена!');
                    return;
                }
                
                const pages = await getPagesCount(supabase, chapter);
                const text = (
                    `📖 *Глава ${chapter}: ${ch.title}*\n\n` +
                    `📄 Страниц: ${pages}\n` +
                    `📥 PDF: ${ch.has_pdf ? '✅ Доступен' : '❌ Нет'}`
                );
                
                await bot.api.editMessageText(
                    chatId,
                    msgId,
                    text,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: await chapterKb(supabase, chapter)
                    }
                );
                return;
            }
            
            if (data.startsWith('png_')) {
                const chapter = parseInt(data.split('_')[1]);
                const progress = await getProgress(supabase, user.id);
                const page = progress.chapter === chapter ? progress.page : 1;
                const total = await getPagesCount(supabase, chapter);
                
                if (total === 0) {
                    await bot.api.answerCallbackQuery(update.callback_query.id, { 
                        text: '❌ В главе нет страниц!', 
                        show_alert: true 
                    });
                    return;
                }
                
                await bot.api.answerCallbackQuery(update.callback_query.id);
                await bot.api.deleteMessage(chatId, msgId);
                await showPage(bot, supabase, chatId, chapter, page, total);
                return;
            }
            
            if (data.startsWith('pdf_')) {
                const chapter = parseInt(data.split('_')[1]);
                const ch = await getChapter(supabase, chapter);
                
                if (!ch || !ch.pdf_file_id) {
                    await bot.api.answerCallbackQuery(update.callback_query.id, { 
                        text: '❌ PDF не найден!', 
                        show_alert: true 
                    });
                    return;
                }
                
                await bot.api.answerCallbackQuery(update.callback_query.id, { 
                    text: '⏳ Отправляю PDF...' 
                });
                
                try {
                    await bot.api.sendDocument(chatId, ch.pdf_file_id, {
                        caption: `📄 Глава ${chapter}: ${ch.title}`
                    });
                    await bot.api.answerCallbackQuery(update.callback_query.id, { 
                        text: '✅ PDF отправлен!' 
                    });
                } catch (e) {
                    await bot.api.answerCallbackQuery(update.callback_query.id, { 
                        text: '❌ Ошибка!', 
                        show_alert: true 
                    });
                }
                return;
            }
            
            if (data.startsWith('album_')) {
                const chapter = parseInt(data.split('_')[1]);
                await bot.api.answerCallbackQuery(update.callback_query.id, { 
                    text: '⏳ Отправляю альбом...' 
                });
                await sendAlbum(bot, supabase, chatId, chapter);
                return;
            }
            
            if (data.startsWith('p_')) {
                const parts = data.split('_');
                const chapter = parseInt(parts[1]);
                const page = parseInt(parts[2]);
                const total = await getPagesCount(supabase, chapter);
                
                let newPage = page;
                if (newPage < 1) newPage = 1;
                if (newPage > total) newPage = total;
                
                await bot.api.answerCallbackQuery(update.callback_query.id);
                await saveProgress(supabase, user.id, chapter, newPage);
                await updatePage(bot, supabase, chatId, msgId, chapter, newPage, total);
                return;
            }
            
            await bot.api.answerCallbackQuery(update.callback_query.id, { 
                text: '⚠️ Неизвестная команда' 
            });
            
        } catch (error) {
            console.error('Callback error:', error);
            await bot.api.answerCallbackQuery(update.callback_query.id, { 
                text: '❌ Ошибка!', 
                show_alert: true 
            });
        }
    }
}

// ========== АДМИНСКИЕ ОБРАБОТЧИКИ ==========

async function processAdminCallback(supabase, bot, adminStates, ADMIN_ID, callbackQuery) {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const msgId = callbackQuery.message.message_id;
    
    if (data === 'admin_png') {
        adminStates.set(ADMIN_ID, { step: 'waiting_number', type: 'png' });
        await bot.api.answerCallbackQuery(callbackQuery.id);
        await bot.api.sendMessage(
            chatId,
            '📤 *Загрузка PNG страниц*\n\nВведи *номер главы* (число):',
            { parse_mode: 'Markdown' }
        );
    } else if (data === 'admin_pdf') {
        adminStates.set(ADMIN_ID, { step: 'waiting_number', type: 'pdf' });
        await bot.api.answerCallbackQuery(callbackQuery.id);
        await bot.api.sendMessage(
            chatId,
            '📤 *Загрузка PDF*\n\nВведи *номер главы* (число):',
            { parse_mode: 'Markdown' }
        );
    } else if (data === 'admin_list') {
        const chapters = await getAllChapters(supabase);
        let text = '📋 *Список глав*\n\n';
        if (chapters.length === 0) {
            text = '📋 *Список глав*\n\nПока нет загруженных глав.';
        } else {
            for (const ch of chapters) {
                const pages = await getPagesCount(supabase, ch.number);
                const pdfIcon = ch.has_pdf ? '✅' : '❌';
                text += `• Глава ${ch.number}: ${ch.title} (${pages} стр.) — PDF: ${pdfIcon}\n`;
            }
        }
        
        await bot.api.answerCallbackQuery(callbackQuery.id);
        await bot.api.editMessageText(
            chatId,
            msgId,
            text,
            {
                parse_mode: 'Markdown',
                reply_markup: adminKb()
            }
        );
    } else if (data === 'admin_delete') {
        const chapters = await getAllChapters(supabase);
        if (chapters.length === 0) {
            await bot.api.answerCallbackQuery(callbackQuery.id, { 
                text: '❌ Нет глав для удаления!', 
                show_alert: true 
            });
            return;
        }
        
        const kb = new InlineKeyboard();
        for (const ch of chapters) {
            kb.text(`🗑️ Глава ${ch.number}: ${ch.title}`, `del_${ch.number}`).row();
        }
        kb.text('🔙 Назад', 'admin_back');
        
        await bot.api.answerCallbackQuery(callbackQuery.id);
        await bot.api.editMessageText(
            chatId,
            msgId,
            '🗑️ *Удаление главы*\n\n⚠️ Внимание! Глава будет удалена полностью!\n\nВыбери главу для удаления:',
            {
                parse_mode: 'Markdown',
                reply_markup: kb
            }
        );
    } else if (data.startsWith('del_')) {
        const chapter = parseInt(data.split('_')[1]);
        await deleteChapter(supabase, chapter);
        await bot.api.answerCallbackQuery(callbackQuery.id);
        await bot.api.editMessageText(
            chatId,
            msgId,
            `✅ *Глава ${chapter} полностью удалена!*`,
            {
                parse_mode: 'Markdown',
                reply_markup: adminKb()
            }
        );
    } else if (data === 'admin_back') {
        await bot.api.answerCallbackQuery(callbackQuery.id);
        await bot.api.editMessageText(
            chatId,
            msgId,
            '🔐 *Админ-панель*\n\nВыбери действие:',
            {
                parse_mode: 'Markdown',
                reply_markup: adminKb()
            }
        );
    } else if (data === 'admin_change_gif') {
        adminStates.set(ADMIN_ID, { step: 'waiting_gif' });
        await bot.api.answerCallbackQuery(callbackQuery.id);
        await bot.api.sendMessage(
            chatId,
            '🖼️ *Смена GIF приветствия*\n\nОтправь ссылку на новую GIF-анимацию (URL) или пришли файл GIF:',
            { parse_mode: 'Markdown' }
        );
    }
}

// ========== РАБОТА СО СТРАНИЦАМИ ==========

async function showPage(bot, supabase, chatId, chapter, page, total) {
    const fileId = await getPageFileId(supabase, chapter, page);
    if (!fileId) {
        await bot.api.sendMessage(chatId, `❌ Страница ${page} не найдена!`);
        return;
    }
    
    const caption = `📖 Глава ${chapter} • Страница ${page}/${total}\n\n📢 Канал автора: @Tainikoskolkov`;
    
    try {
        await bot.api.sendPhoto(chatId, fileId, {
            caption: caption,
            parse_mode: 'Markdown',
            reply_markup: pageKb(chapter, page, total)
        });
    } catch (error) {
        console.error('Show page error:', error);
        await bot.api.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
}

async function updatePage(bot, supabase, chatId, msgId, chapter, page, total) {
    const fileId = await getPageFileId(supabase, chapter, page);
    if (!fileId) {
        await bot.api.sendMessage(chatId, `❌ Страница ${page} не найдена!`);
        return;
    }
    
    const caption = `📖 Глава ${chapter} • Страница ${page}/${total}\n\n📢 Канал автора: @Tainikoskolkov`;
    
    try {
        await bot.api.deleteMessage(chatId, msgId);
        await bot.api.sendPhoto(chatId, fileId, {
            caption: caption,
            parse_mode: 'Markdown',
            reply_markup: pageKb(chapter, page, total)
        });
    } catch (error) {
        console.error('Update page error:', error);
        await showPage(bot, supabase, chatId, chapter, page, total);
    }
}

async function sendAlbum(bot, supabase, chatId, chapter) {
    const { data: pages, error } = await supabase
        .from('pages')
        .select('page, file_id')
        .eq('chapter', chapter)
        .order('page');
    
    if (error || !pages || pages.length === 0) {
        await bot.api.sendMessage(chatId, '❌ В главе нет страниц!');
        return;
    }
    
    const chunkSize = 10;
    for (let i = 0; i < pages.length; i += chunkSize) {
        const chunk = pages.slice(i, i + chunkSize);
        const media = chunk.map((p, idx) => ({
            type: 'photo',
            media: p.file_id,
            caption: (i === 0 && idx === 0) ? `📖 Глава ${chapter} (все страницы)` : ''
        }));
        
        try {
            await bot.api.sendMediaGroup(chatId, media);
        } catch (e) {
            console.error('Album error:', e);
        }
    }
    
    await bot.api.sendMessage(chatId, `✅ Все страницы главы ${chapter} отправлены!`);
}

// ========== АДМИНСКИЕ ШАГИ ==========

async function processAdminStep(supabase, bot, adminStates, ADMIN_ID, update) {
    const user = update.message.from;
    const state = adminStates.get(user.id);
    const chatId = update.message.chat.id;
    
    if (!state) return;
    
    if (state.step === 'waiting_gif') {
        let gifUrl = null;
        
        if (update.message.document) {
            const document = update.message.document;
            if (document.mime_type === 'image/gif') {
                gifUrl = document.file_id;
            } else {
                await bot.api.sendMessage(chatId, '❌ Отправь GIF файл или ссылку на GIF!');
                return;
            }
        }
        else if (update.message.text) {
            const text = update.message.text.trim();
            if (text.startsWith('http://') || text.startsWith('https://')) {
                gifUrl = text;
            } else {
                await bot.api.sendMessage(chatId, '❌ Отправь корректную ссылку на GIF!');
                return;
            }
        } else {
            await bot.api.sendMessage(chatId, '❌ Отправь ссылку на GIF или GIF файл!');
            return;
        }
        
        if (gifUrl) {
            await updateSettings(supabase, 'welcome_gif', gifUrl);
            adminStates.delete(ADMIN_ID);
            await bot.api.sendMessage(
                chatId,
                `✅ *GIF приветствия обновлен!*`,
                { parse_mode: 'Markdown' }
            );
            
            await bot.api.sendMessage(
                chatId,
                '🔐 *Админ-панель*\n\nВыбери действие:',
                {
                    parse_mode: 'Markdown',
                    reply_markup: adminKb()
                }
            );
        }
        return;
    }
    
    if (update.message.photo && state.step === 'waiting_png') {
        const fileId = update.message.photo[update.message.photo.length - 1].file_id;
        const chapter = state.chapter;
        const pageNum = (state.pages || 0) + 1;
        
        try {
            await addPage(supabase, chapter, pageNum, fileId);
            state.pages = pageNum;
            await bot.api.sendMessage(chatId, `✅ Страница ${pageNum} сохранена!`);
        } catch (error) {
            console.error('PNG upload error:', error);
            await bot.api.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
        }
        return;
    }
    
    if (update.message.document && state.step === 'waiting_pdf') {
        const document = update.message.document;
        if (!document.file_name.toLowerCase().endsWith('.pdf')) {
            await bot.api.sendMessage(chatId, '❌ Отправь файл в формате PDF!');
            return;
        }
        
        const chapter = state.chapter;
        const title = state.title || 'Без названия';
        const fileId = document.file_id;
        
        try {
            const existing = await getChapter(supabase, chapter);
            if (existing) {
                await updateChapterPdf(supabase, chapter, true, fileId);
                await bot.api.sendMessage(chatId, `✅ *PDF добавлен к главе ${chapter}*`, { parse_mode: 'Markdown' });
            } else {
                await addChapter(supabase, chapter, title, 0, true, fileId);
                await bot.api.sendMessage(chatId, `✅ *Глава ${chapter} создана с PDF!*`, { parse_mode: 'Markdown' });
            }
            adminStates.delete(ADMIN_ID);
        } catch (error) {
            console.error('PDF upload error:', error);
            await bot.api.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
        }
        return;
    }
    
    if (!update.message.text) return;
    
    const text = update.message.text.trim();
    
    if (state.step === 'waiting_number') {
        const chapter = parseInt(text);
        if (isNaN(chapter) || chapter < 1) {
            await bot.api.sendMessage(chatId, '❌ Введи число больше 0!');
            return;
        }
        
        state.chapter = chapter;
        state.step = 'waiting_title';
        await bot.api.sendMessage(
            chatId,
            `✅ Номер главы: ${chapter}\n\nТеперь введи *название главы*:`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    if (state.step === 'waiting_title') {
        const title = text.trim();
        if (title.length < 1) {
            await bot.api.sendMessage(chatId, '❌ Название не может быть пустым!');
            return;
        }
        
        state.title = title;
        
        if (state.type === 'png') {
            state.step = 'waiting_png';
            state.pages = 0;
            await bot.api.sendMessage(
                chatId,
                `📤 *Загрузка PNG страниц*\n\n` +
                `Глава ${state.chapter}: «${title}»\n\n` +
                'Отправляй PNG файлы по одному.\n' +
                'Когда закончишь, напиши *готово*:',
                { parse_mode: 'Markdown' }
            );
        } else {
            state.step = 'waiting_pdf';
            await bot.api.sendMessage(
                chatId,
                `📤 *Загрузка PDF*\n\n` +
                `Глава ${state.chapter}: «${title}»\n\n` +
                'Отправь *PDF файл*:',
                { parse_mode: 'Markdown' }
            );
        }
        return;
    }
    
    if (state.step === 'waiting_png') {
        if (['готово', 'стоп', 'done', 'end'].includes(text.toLowerCase())) {
            const chapter = state.chapter;
            const title = state.title;
            const pages = state.pages || 0;
            
            if (pages === 0) {
                await bot.api.sendMessage(chatId, '❌ Не загружено ни одной страницы!');
                adminStates.delete(ADMIN_ID);
                return;
            }
            
            const existing = await getChapter(supabase, chapter);
            if (existing) {
                await updateChapterPages(supabase, chapter, pages);
                await bot.api.sendMessage(chatId, `✅ *Страницы добавлены к главе ${chapter}*`, { parse_mode: 'Markdown' });
            } else {
                await addChapter(supabase, chapter, title, pages, false);
                await bot.api.sendMessage(chatId, `✅ *Глава ${chapter} создана!*\n📄 Страниц: ${pages}`, { parse_mode: 'Markdown' });
            }
            adminStates.delete(ADMIN_ID);
        } else {
            await bot.api.sendMessage(chatId, '📤 Отправляй PNG страницы.\nНапиши *готово* когда закончишь:', { parse_mode: 'Markdown' });
        }
    }
}

// ========== WEBHOOK ==========

app.get('/', async (c) => {
    return c.text('🌿 Дневник Лозы - бот работает!\n\nХранилище: Supabase');
});

app.get('/stats', async (c) => {
    try {
        const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_KEY);
        const chapters = await getAllChapters(supabase);
        let totalPages = 0;
        for (const ch of chapters) {
            totalPages += await getPagesCount(supabase, ch.number);
        }
        
        const { count: usersCount } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });
        
        return c.text(
            `📊 Статистика бота\n\n` +
            `📚 Всего глав: ${chapters.length}\n` +
            `📄 Всего страниц: ${totalPages}\n` +
            `👥 Пользователей: ${usersCount || 0}\n` +
            `💾 Хранилище: Supabase`
        );
    } catch (error) {
        return c.text(`❌ Ошибка: ${error.message}`);
    }
});

app.get('/set_webhook', async (c) => {
    try {
        const url = new URL(c.req.url);
        const webhookUrl = `${url.origin}/webhook`;
        const BOT_TOKEN = c.env.BOT_TOKEN;
        
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: webhookUrl,
                max_connections: 100
            })
        });
        
        const result = await response.json();
        
        if (result.ok) {
            return c.text(`✅ Webhook установлен на: ${webhookUrl}\n\nХранилище: Supabase`);
        } else {
            return c.text(`❌ Ошибка: ${result.description}`);
        }
    } catch (error) {
        return c.text(`❌ Ошибка: ${error.message}`);
    }
});

app.post('/webhook', async (c) => {
    try {
        const BOT_TOKEN = c.env.BOT_TOKEN;
        const ADMIN_ID = parseInt(c.env.ADMIN_ID);
        const SUPABASE_URL = c.env.SUPABASE_URL;
        const SUPABASE_KEY = c.env.SUPABASE_KEY;
        
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        const bot = new Bot(BOT_TOKEN);
        const adminStates = new Map();
        
        const body = await c.req.json();
        
        await handleUpdate(supabase, bot, adminStates, ADMIN_ID, body);
        
        return c.text('OK', 200);
    } catch (error) {
        console.error('Webhook error:', error);
        return c.text('Error', 500);
    }
});

export default app;
