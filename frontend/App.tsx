import React, {useEffect, useState} from 'react';
import {View, ActivityIndicator, StyleSheet} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {ThemeProvider} from './src/app/theme/ThemeContext';
import RootStack from './src/app/navigation/RootStack';
import {checkAndUpdateModel} from './src/ota/modelDownloader';
import {getOrCreateDbKey} from './src/storage/secure/dbKey';
import './src/i18n';

export default function App() {
  // Gate the UI until the SQLCipher key is resolved so no screen renders (and
  // calls getDb()) before encryption is ready — getDb() now refuses to open
  // the DB unkeyed. bootReady flips even if the key bootstrap throws, so a rare
  // keychain failure degrades gracefully instead of bricking on a splash.
  const [bootReady, setBootReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await getOrCreateDbKey();
      } catch (e) {
        console.warn('[App] dbKey bootstrap failed:', e);
      }
      if (!mounted) return;
      setBootReady(true);
      checkAndUpdateModel().catch(() => {});
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        {bootReady ? (
          <NavigationContainer>
            <RootStack />
          </NavigationContainer>
        ) : (
          <View style={styles.splash}>
            <ActivityIndicator size="large" color="#3B82F6" />
          </View>
        )}
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  splash: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F172A'},
});
