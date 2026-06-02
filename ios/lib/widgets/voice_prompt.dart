import 'package:flutter_tts/flutter_tts.dart';

class VoicePrompt {
  static final VoicePrompt _instance = VoicePrompt._();
  factory VoicePrompt() => _instance;
  VoicePrompt._();

  final FlutterTts _tts = FlutterTts();
  bool _initialized = false;

  Future<void> _init() async {
    if (_initialized) return;
    await _tts.setSpeechRate(0.5);
    await _tts.setVolume(1.0);
    await _tts.setPitch(1.0);
    _initialized = true;
  }

  Future<void> setLocale(String langCode) async {
    await _init();
    final locale = langCode == 'hi' ? 'hi-IN' : 'en-US';
    await _tts.setLanguage(locale);
  }

  Future<void> speak(String text, {bool flush = true}) async {
    await _init();
    if (flush) await _tts.stop();
    await _tts.speak(text);
  }

  Future<void> stop() async {
    await _tts.stop();
  }
}
