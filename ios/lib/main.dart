import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'theme/app_theme.dart';
import 'i18n/app_localizations.dart';
import 'services/session_store.dart';
import 'app_router.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const NhaiFaceAuthApp());
}

class NhaiFaceAuthApp extends StatelessWidget {
  const NhaiFaceAuthApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => ThemeNotifier()),
        ChangeNotifierProvider(create: (_) => LocaleNotifier()),
        ChangeNotifierProvider(create: (_) => SessionStore()..init()),
      ],
      child: Consumer2<ThemeNotifier, LocaleNotifier>(
        builder: (context, themeNotifier, localeNotifier, _) {
          return MaterialApp.router(
            title: 'NHAI Face Auth',
            debugShowCheckedModeBanner: false,
            theme: themeNotifier.isAAA
                ? AppTheme.aaaTheme
                : AppTheme.normalTheme,
            locale: localeNotifier.locale,
            supportedLocales: const [Locale('en'), Locale('hi')],
            localizationsDelegates: [
              AppLocalizationsDelegate(localeNotifier),
            ],
            routerConfig: appRouter,
          );
        },
      ),
    );
  }
}
