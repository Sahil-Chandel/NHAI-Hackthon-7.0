import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../i18n/app_localizations.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../services/session_store.dart';

class WelcomeScreen extends StatefulWidget {
  const WelcomeScreen({super.key});

  @override
  State<WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends State<WelcomeScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _fadeAnim;
  late Animation<double> _scaleAnim;
  Timer? _autoNavTimer;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
    _fadeAnim = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeOut),
    );
    _scaleAnim = Tween<double>(begin: 0.8, end: 1.0).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeOutBack),
    );
    _animController.forward();

    _autoNavTimer = Timer(const Duration(seconds: 2), _navigate);
  }

  @override
  void dispose() {
    _autoNavTimer?.cancel();
    _animController.dispose();
    super.dispose();
  }

  // Worker-only entry: a returning worker (valid session) goes straight to
  // Punch; everyone else starts the one-time Datalake onboarding. Admin is no
  // longer reachable from the app entry.
  void _navigate() {
    if (!mounted) return;
    final session = SessionStore();
    if (session.isWorker && session.token != null) {
      context.go('/worker/punch');
    } else {
      context.go('/worker/onboard');
    }
  }

  @override
  Widget build(BuildContext context) {
    final loc = AppLocalizations.of(context);
    final themeNotifier = context.watch<ThemeNotifier>();
    final colors = themeNotifier.isAAA ? AppColors.aaa : AppColors.normal;

    return Scaffold(
      backgroundColor: colors.bg,
      body: SafeArea(
        child: AnimatedBuilder(
          animation: _animController,
          builder: (context, child) {
            return Opacity(
              opacity: _fadeAnim.value,
              child: Transform.scale(
                scale: _scaleAnim.value,
                child: child,
              ),
            );
          },
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // NHAI logo
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 16, vertical: 12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Image.asset(
                      'assets/nhai_logo.png',
                      width: 150,
                      height: 96,
                      fit: BoxFit.contain,
                    ),
                  ),
                  const SizedBox(height: 32),
                  // Title
                  Text(
                    loc?.t('welcome.title') ?? 'NHAI Attendance',
                    style: TextStyle(
                      color: colors.text,
                      fontSize: 28,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 12),
                  // Subtitle
                  Text(
                    loc?.t('welcome.subtitle') ??
                        'Face-verified worker attendance',
                    style: TextStyle(
                      color: colors.textSecondary,
                      fontSize: 16,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 48),
                  // Get Started button
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _navigate,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: colors.primary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: Text(
                        loc?.t('welcome.worker_btn') ?? 'Login as Worker',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 48),
                  // Developed-by credit
                  Text(
                    loc?.t('welcome.credit') ?? 'Developed by PramIQ',
                    style: TextStyle(
                      color: colors.text,
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.5,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  // Footer
                  Text(
                    loc?.t('welcome.footer') ??
                        'Offline-first • DPDPA-aware • Made in India',
                    style: TextStyle(
                      color: colors.textMuted,
                      fontSize: 12,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
